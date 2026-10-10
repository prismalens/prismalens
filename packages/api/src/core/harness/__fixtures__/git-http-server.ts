// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A local git server for tests (#673): `git http-backend` over bare repos, one mode per repo.
 * HTTPS uses a throwaway self-signed certificate from `openssl`; point git at `caFile` (`http.sslCAInfo`).
 */
import { execFileSync, spawn } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {
	createServer as createHttpServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type RepoMode =
	| { kind: "anonymous" }
	| { kind: "basic"; user: string; pass: string }
	| { kind: "reject-401" }
	| { kind: "forbid-403" }
	| { kind: "missing-404" };

export interface RecordedRequest {
	method: string;
	/** Path without the query, e.g. `/acme/api.git/info/refs`. */
	path: string;
	query: string;
	/** Node's raw header list: name, value, name, value… Duplicates are kept. */
	rawHeaders: string[];
}

export interface GitHttpServer {
	/** `https://127.0.0.1:<port>` (or `http://` when started without TLS). */
	url: string;
	/** The `GIT_PROJECT_ROOT` the bare repos live under. */
	root: string;
	/** The server's self-signed certificate, for `http.sslCAInfo`; undefined without TLS. */
	caFile?: string;
	/** A bare repo `<name>.git` with one commit `a.txt` on `main`; returns its clone URL. */
	addRepo(name: string, mode?: RepoMode): string;
	setMode(name: string, mode: RepoMode): void;
	/** The head commit of `<name>.git`. */
	headOf(name: string): string;
	requests: RecordedRequest[];
	/** Every value of header `name` the server received, across all requests. */
	headerValues(name: string): string[];
	close(): Promise<void>;
}

const FIXTURE_GIT_ENV = {
	...process.env,
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_TERMINAL_PROMPT: "0",
};

function git(args: string[], cwd: string): string {
	return execFileSync("git", args, { cwd, env: FIXTURE_GIT_ENV })
		.toString()
		.trim();
}

function selfSignedCert(dir: string): {
	key: string;
	cert: string;
	caFile: string;
} {
	const keyFile = join(dir, "key.pem");
	const caFile = join(dir, "cert.pem");
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			keyFile,
			"-out",
			caFile,
			"-days",
			"1",
			"-subj",
			"/CN=127.0.0.1",
			"-addext",
			"subjectAltName=IP:127.0.0.1,DNS:localhost",
		],
		{ stdio: "ignore" },
	);
	return {
		key: readFileSync(keyFile, "utf8"),
		cert: readFileSync(caFile, "utf8"),
		caFile,
	};
}

/** Splits a CGI response into its header block and the start of its body. */
function splitCgi(buf: Buffer): { head: string; body: Buffer } | null {
	for (const sep of ["\r\n\r\n", "\n\n"]) {
		const at = buf.indexOf(sep);
		if (at >= 0)
			return {
				head: buf.subarray(0, at).toString("utf8"),
				body: buf.subarray(at + sep.length),
			};
	}
	return null;
}

export async function startGitHttpServer(
	opts: { tls?: boolean } = {},
): Promise<GitHttpServer> {
	const tls = opts.tls ?? true;
	const base = mkdtempSync(join(tmpdir(), "pl-git-http-"));
	const root = join(base, "repos");
	mkdirSync(root, { recursive: true });
	const modes = new Map<string, RepoMode>();
	const requests: RecordedRequest[] = [];

	const refuse = (
		res: ServerResponse,
		status: number,
		body: string,
		headers: Record<string, string> = {},
	) => {
		res.writeHead(status, {
			"Content-Type": "text/plain; charset=utf-8",
			...headers,
		});
		res.end(body);
	};

	const handler = (req: IncomingMessage, res: ServerResponse) => {
		const u = new URL(req.url ?? "/", "http://fixture");
		requests.push({
			method: req.method ?? "GET",
			path: u.pathname,
			query: u.search.replace(/^\?/, ""),
			rawHeaders: [...req.rawHeaders],
		});
		const name = u.pathname.replace(/^\/+/, "").split(".git")[0] ?? "";
		const mode = modes.get(name) ?? { kind: "anonymous" as const };
		let remoteUser = "";
		if (mode.kind === "reject-401")
			return refuse(res, 401, "Unauthorized\n", {
				"WWW-Authenticate": 'Basic realm="git"',
			});
		if (mode.kind === "forbid-403") return refuse(res, 403, "Forbidden\n");
		if (mode.kind === "missing-404")
			return refuse(res, 404, "Repository not found.\n");
		if (mode.kind === "basic") {
			const expected = `Basic ${Buffer.from(`${mode.user}:${mode.pass}`).toString("base64")}`;
			if (req.headers.authorization !== expected)
				return refuse(res, 401, "Unauthorized\n", {
					"WWW-Authenticate": 'Basic realm="git"',
				});
			remoteUser = mode.user;
		}
		const child = spawn("git", ["http-backend"], {
			env: {
				...FIXTURE_GIT_ENV,
				GIT_PROJECT_ROOT: root,
				GIT_HTTP_EXPORT_ALL: "1",
				PATH_INFO: u.pathname,
				REQUEST_METHOD: req.method ?? "GET",
				QUERY_STRING: u.search.replace(/^\?/, ""),
				CONTENT_TYPE: req.headers["content-type"] ?? "",
				REMOTE_ADDR: req.socket.remoteAddress ?? "127.0.0.1",
				...(remoteUser ? { REMOTE_USER: remoteUser } : {}),
				...(req.headers["git-protocol"]
					? { GIT_PROTOCOL: String(req.headers["git-protocol"]) }
					: {}),
				...(req.headers["content-encoding"]
					? { HTTP_CONTENT_ENCODING: String(req.headers["content-encoding"]) }
					: {}),
			},
			stdio: ["pipe", "pipe", "ignore"],
		});
		req.pipe(child.stdin);
		let pending: Buffer = Buffer.alloc(0);
		let started = false;
		child.stdout.on("data", (chunk: Buffer) => {
			if (started) return void res.write(chunk);
			pending = Buffer.concat([pending, chunk]);
			const split = splitCgi(pending);
			if (!split) return;
			started = true;
			let status = 200;
			const headers: Record<string, string> = {};
			for (const line of split.head.split(/\r?\n/)) {
				const at = line.indexOf(":");
				if (at < 0) continue;
				const key = line.slice(0, at).trim();
				const value = line.slice(at + 1).trim();
				if (key.toLowerCase() === "status")
					status = Number.parseInt(value, 10) || 200;
				else headers[key] = value;
			}
			res.writeHead(status, headers);
			if (split.body.length) res.write(split.body);
		});
		child.on("close", () => {
			if (!started) refuse(res, 500, "http-backend wrote no response\n");
			else res.end();
		});
	};

	const cert = tls ? selfSignedCert(base) : null;
	const server = cert
		? createHttpsServer({ key: cert.key, cert: cert.cert }, handler)
		: createHttpServer(handler);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	const url = `${tls ? "https" : "http"}://127.0.0.1:${port}`;

	return {
		url,
		root,
		caFile: cert?.caFile,
		requests,
		addRepo(name, mode = { kind: "anonymous" }) {
			const bare = join(root, `${name}.git`);
			git(["init", "-q", "--bare", "-b", "main", bare], root);
			const work = mkdtempSync(join(base, "work-"));
			git(["init", "-q", "-b", "main", work], base);
			writeFileSync(join(work, "a.txt"), `${name}\n`);
			git(["add", "a.txt"], work);
			git(
				[
					"-c",
					"user.email=fixture@test.local",
					"-c",
					"user.name=Fixture",
					"commit",
					"-q",
					"-m",
					"init",
				],
				work,
			);
			git(["push", "-q", bare, "main"], work);
			rmSync(work, { recursive: true, force: true });
			modes.set(name, mode);
			return `${url}/${name}.git`;
		},
		setMode(name, mode) {
			modes.set(name, mode);
		},
		headOf(name) {
			return git(["rev-parse", "main"], join(root, `${name}.git`));
		},
		headerValues(name) {
			const lower = name.toLowerCase();
			return requests.flatMap((r) =>
				r.rawHeaders.flatMap((value, i) =>
					i % 2 === 1 && r.rawHeaders[i - 1]?.toLowerCase() === lower
						? [value]
						: [],
				),
			);
		},
		close() {
			return new Promise<void>((resolve) => {
				server.close(() => {
					rmSync(base, { recursive: true, force: true });
					resolve();
				});
				server.closeAllConnections?.();
			});
		},
	};
}
