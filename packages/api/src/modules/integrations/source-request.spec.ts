// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { createServer as createTlsServer, request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import {
	parseSourceCredential,
	type SourceCredential,
} from "@prismalens/contracts/schemas";
import { afterEach, describe, expect, it } from "vitest";
import {
	CA_CERT,
	CLIENT_CERT,
	CLIENT_KEY,
	SERVER_CERT,
	SERVER_KEY,
} from "./__fixtures__/mtls.js";
import {
	OffHostRedirectError,
	SourceConfigError,
	sourceRequestFn,
	TRUNCATED_HEADER,
} from "./source-request.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
const servers: Server[] = [];

async function listen(server: Server, scheme: "http" | "https") {
	servers.push(server);
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return `${scheme}://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const fake = (handler: Handler) => listen(createServer(handler), "http");

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map((s) => new Promise((r) => s.close(r))),
	);
});

const ok = (c: SourceCredential) => ({ ok: true as const, credential: c });

describe("sourceRequestFn: each credential kind reaches the upstream (#848)", () => {
	const cases: [SourceCredential, string, string | undefined][] = [
		[{ kind: "none" }, "authorization", undefined],
		[{ kind: "bearer", token: "tok-123" }, "authorization", "Bearer tok-123"],
		[
			{ kind: "basic", username: "amy", password: "pw-456" },
			"authorization",
			`Basic ${Buffer.from("amy:pw-456").toString("base64")}`,
		],
		[
			{ kind: "header", name: "CF-Access-Client-Secret", value: "cf-789" },
			"cf-access-client-secret",
			"cf-789",
		],
	];
	for (const [credential, header, expected] of cases)
		it(`${credential.kind}`, async () => {
			let seen: string | undefined;
			let path = "";
			const base = await fake((req, res) => {
				seen = req.headers[header] as string | undefined;
				path = req.url ?? "";
				res.end("{}");
			});
			const res = await sourceRequestFn(`${base}/prom`, ok(credential))(
				"GET",
				"/api/v1/query?query=up",
			);
			expect(res.status).toBe(200);
			expect(seen).toBe(expected);
			expect(path).toBe("/prom/api/v1/query?query=up");
		});

	it("mtls presents the client certificate", async () => {
		const server = createTlsServer(
			{
				cert: SERVER_CERT,
				key: SERVER_KEY,
				ca: CA_CERT,
				requestCert: true,
				rejectUnauthorized: true,
			},
			(req, res) => {
				const peer = (req.socket as TLSSocket).getPeerCertificate();
				res.end(JSON.stringify({ cn: peer.subject?.CN }));
			},
		);
		const base = await listen(server, "https");
		const mtls = ok({
			kind: "mtls",
			cert: CLIENT_CERT,
			key: CLIENT_KEY,
			ca: CA_CERT,
		});
		const res = await sourceRequestFn(base, mtls)("GET", "/-/ready");
		expect(await res.json()).toEqual({ cn: "client" });
		// Without the client certificate the same server refuses the handshake.
		await expect(
			new Promise((resolve, reject) => {
				const r = httpsRequest(`${base}/-/ready`, { ca: CA_CERT }, resolve);
				r.on("error", reject);
				r.end();
			}),
		).rejects.toThrow();
	});

	it("mtls refuses a plain http URL", async () => {
		const fn = sourceRequestFn(
			"http://127.0.0.1:1",
			ok({ kind: "mtls", cert: CLIENT_CERT, key: CLIENT_KEY }),
		);
		await expect(fn("GET", "/")).rejects.toBeInstanceOf(SourceConfigError);
	});
});

describe("sourceRequestFn: redirects", () => {
	it("follows a redirect on the same origin, with the credential", async () => {
		const auth: (string | undefined)[] = [];
		const base = await fake((req, res) => {
			auth.push(req.headers.authorization);
			if (req.url === "/old") {
				res.writeHead(302, { location: "/new" });
				return res.end();
			}
			res.end("here");
		});
		const res = await sourceRequestFn(base, ok({ kind: "bearer", token: "t1" }))(
			"GET",
			"/old",
		);
		expect(await res.text()).toBe("here");
		expect(auth).toEqual(["Bearer t1", "Bearer t1"]);
	});

	it("fails a redirect to another host and never sends it the credential", async () => {
		let otherHit = false;
		const other = await fake((_req, res) => {
			otherHit = true;
			res.end();
		});
		const base = await fake((_req, res) => {
			res.writeHead(307, { location: `${other}/steal` });
			res.end();
		});
		await expect(
			sourceRequestFn(base, ok({ kind: "bearer", token: "t2" }))("GET", "/"),
		).rejects.toBeInstanceOf(OffHostRedirectError);
		expect(otherHit).toBe(false);
	});
});

describe("sourceRequestFn: limits and unsupported kinds", () => {
	it("stops reading past maxBytes and marks the response", async () => {
		const base = await fake((_req, res) => res.end("x".repeat(10_000)));
		const res = await sourceRequestFn(base, ok({ kind: "none" }), {
			maxBytes: 1_000,
		})("GET", "/");
		expect(res.headers.get(TRUNCATED_HEADER)).toBe("1");
		expect((await res.text()).length).toBe(1_000);
	});

	it("an unsupported kind rejects with its name, and no request is made", async () => {
		let hit = false;
		const base = await fake((_req, res) => {
			hit = true;
			res.end();
		});
		const parsed = parseSourceCredential({ kind: "aws-sigv4", region: "x" });
		expect(parsed).toMatchObject({ ok: false, reason: "unsupported" });
		await expect(sourceRequestFn(base, parsed)("GET", "/")).rejects.toThrow(
			"AWS SigV4 / assume-role credentials are not supported yet.",
		);
		expect(hit).toBe(false);
	});
});
