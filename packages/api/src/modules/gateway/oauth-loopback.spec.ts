// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOOPBACK_BUSY, OAuthLoopback } from "./oauth-loopback.js";

const PORT = 46474;
const open: OAuthLoopback[] = [];
const blockers: Server[] = [];

afterEach(async () => {
	for (const l of open.splice(0)) l.close();
	await Promise.all(blockers.splice(0).map((s) => new Promise((r) => s.close(r))));
	vi.useRealTimers();
});

function loopback(opts: { ttlMs?: number } = {}) {
	const seen: URLSearchParams[] = [];
	const l = new OAuthLoopback(
		async (p) => {
			seen.push(p);
			return true;
		},
		{ port: PORT, ...opts },
	);
	open.push(l);
	return { l, seen };
}

const hit = (state: string, host = "127.0.0.1") =>
	fetch(`http://${host}:${PORT}/callback?code=c&state=${state}`);

describe("OAuthLoopback (#848, 04)", () => {
	it("binds 127.0.0.1 only, on 6474 by default", async () => {
		const { l } = loopback();
		await l.expect("s1");
		const server = (l as unknown as { server: { address(): { address: string } } }).server;
		expect(server.address().address).toBe("127.0.0.1");
		expect(
			(new OAuthLoopback(async () => true) as unknown as { port: number }).port,
		).toBe(6474);
	});

	it("takes one callback, then closes", async () => {
		const { l, seen } = loopback();
		await l.expect("s1");
		const res = await hit("s1");
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("Signed in");
		expect(seen.map((p) => p.get("code"))).toEqual(["c"]);
		await vi.waitFor(() => expect(l.listening).toBe(false));
		await expect(hit("s1")).rejects.toThrow();
	});

	it("refuses a state it is not waiting for, and stays open for the real one", async () => {
		const { l, seen } = loopback();
		await l.expect("s1");
		const res = await hit("forged");
		expect(res.status).toBe(400);
		expect(seen).toHaveLength(0);
		expect(l.listening).toBe(true);
	});

	it("closes after the time limit with no callback", async () => {
		const { l } = loopback({ ttlMs: 50 });
		await l.expect("s1");
		expect(l.listening).toBe(true);
		await vi.waitFor(() => expect(l.listening).toBe(false), { timeout: 2000 });
	});

	it("a busy port gives PrismaLens's message", async () => {
		const blocker = createServer();
		blockers.push(blocker);
		await new Promise<void>((r) => blocker.listen(PORT, "127.0.0.1", r));
		const { l } = loopback();
		await expect(l.expect("s1")).rejects.toThrow(LOOPBACK_BUSY);
	});
});
