// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFile } from "node:child_process";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import type { Plugin } from "vite";

const run = promisify(execFile);
const RETRY_AFTER_FAILURE_MS = 10_000;

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Pairing mints operator scopes, so only a browser on this machine gets one:
 * a loopback socket rules out `--host`, a local Host header rules out tunnels.
 */
export function isLocalRequest(req: IncomingMessage): boolean {
	const hostname = (req.headers.host ?? "").replace(/:\d+$/, "");
	return (
		LOOPBACK.has(req.socket.remoteAddress ?? "") &&
		LOCAL_HOSTNAMES.has(hostname)
	);
}

export async function isPaired(
	apiOrigin: string,
	cookie: string | undefined,
): Promise<boolean> {
	const res = await fetch(`${apiOrigin}/api/operator/whoami`, {
		headers: cookie ? { cookie } : {},
	});
	if (!res.ok) throw new Error(`whoami ${res.status}: ${await res.text()}`);
	const body = (await res.json()) as { via: string | null };
	return body.via !== null;
}

/**
 * `vite dev` only: pair the browser as this machine's host with no link to
 * find. The device is minted and redeemed through the real API (ADR 0004 §8),
 * so dev runs the production auth path; only the click is gone. Off for e2e,
 * which pairs itself (e2e/pair.setup.ts).
 */
export function devPair(options: { apiOrigin: string }): Plugin {
	let inflight: Promise<string[]> | null = null;
	let failedAt = 0;

	async function pair(): Promise<string[]> {
		const { stdout } = await run(
			"pnpm",
			["--silent", "--filter", "prismalens", "dev", "pair", "--operator"],
			{ cwd: process.cwd() },
		);
		const token = stdout.match(/\/pair#([^\s#]+)/)?.[1];
		if (!token) throw new Error(`no pairing link in:\n${stdout}`);
		const res = await fetch(`${options.apiOrigin}/api/pairing/redeem`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token, name: "dev browser" }),
		});
		if (!res.ok) throw new Error(`redeem ${res.status}: ${await res.text()}`);
		return res.headers.getSetCookie();
	}

	return {
		name: "prismalens:dev-pair",
		apply: "serve",
		configureServer(server) {
			if (process.env.PRISMALENS_DEV_PAIR === "off") return;
			server.middlewares.use(async (req, res, next) => {
				const path = (req.url ?? "").split("?")[0];
				const navigation =
					req.method === "GET" &&
					isLocalRequest(req) &&
					req.headers.accept?.includes("text/html") &&
					path !== "/pair";
				if (!navigation || Date.now() - failedAt < RETRY_AFTER_FAILURE_MS) {
					return next();
				}
				try {
					if (await isPaired(options.apiOrigin, req.headers.cookie))
						return next();
					inflight ??= pair().finally(() => {
						inflight = null;
					});
					const cookies = await inflight;
					res.statusCode = 302;
					for (const c of cookies) res.appendHeader("set-cookie", c);
					res.setHeader("location", req.url ?? "/");
					res.end();
				} catch (error) {
					failedAt = Date.now();
					server.config.logger.warn(
						`dev auto-pair skipped (open the link the API prints instead): ${error instanceof Error ? error.message : error}`,
					);
					next();
				}
			});
		},
	};
}
