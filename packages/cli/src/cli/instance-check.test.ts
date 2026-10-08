// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
	checkIdentity,
	fetchWithHost,
	lockBase,
	probeInstance,
} from "./instance-check.js";
import { pairRefusal } from "./pair.js";
import { runningLine } from "./service.js";

const ID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";

function answering(status: number, body?: unknown): typeof fetch {
	return (async () =>
		new Response(body === undefined ? "" : JSON.stringify(body), {
			status,
		})) as unknown as typeof fetch;
}
const refused = (async () => {
	throw Object.assign(new TypeError("fetch failed"), {
		cause: { code: "ECONNREFUSED" },
	});
}) as unknown as typeof fetch;
const alive = () => true;

describe("identity outcomes", () => {
	const base = "http://127.0.0.1:6473";
	it("ok when the pid lives and the id matches", async () => {
		expect(
			await checkIdentity(
				{ pid: 1, base, instanceId: ID },
				{ isAlive: alive, fetchImpl: answering(200, { instanceId: ID }) },
			),
		).toEqual({ kind: "ok" });
	});
	it("not-running when there is no pid or it is dead", async () => {
		const fetchImpl = answering(200, { instanceId: ID });
		expect(
			await checkIdentity({ pid: null, base, instanceId: ID }, { fetchImpl }),
		).toEqual({ kind: "not-running" });
		expect(
			await checkIdentity(
				{ pid: 1, base, instanceId: ID },
				{ fetchImpl, isAlive: () => false },
			),
		).toEqual({ kind: "not-running" });
	});
	it("unreachable on a refused connection or a 5xx", async () => {
		expect(await probeInstance(base, ID, { fetchImpl: refused })).toEqual({
			kind: "unreachable",
			reason: "ECONNREFUSED",
		});
		expect(
			await probeInstance(base, ID, { fetchImpl: answering(502) }),
		).toEqual({ kind: "unreachable", reason: "HTTP 502" });
	});
	it("forbidden-host on 403", async () => {
		expect(
			await probeInstance(base, ID, { fetchImpl: answering(403) }),
		).toEqual({ kind: "forbidden-host" });
	});
	it("different-instance on another id or no JSON", async () => {
		expect(
			await probeInstance(base, ID, {
				fetchImpl: answering(200, { instanceId: OTHER }),
			}),
		).toEqual({ kind: "different-instance", instanceId: OTHER });
		const html = (async () =>
			new Response("<html>", { status: 200 })) as unknown as typeof fetch;
		expect(await probeInstance(base, ID, { fetchImpl: html })).toEqual({
			kind: "different-instance",
			instanceId: null,
		});
	});
	it("does not follow redirects and times out", async () => {
		let init: RequestInit | undefined;
		const spy = (async (_u: string, i: RequestInit) => {
			init = i;
			return new Response("", { status: 302 });
		}) as unknown as typeof fetch;
		expect((await probeInstance(base, ID, { fetchImpl: spy })).kind).toBe(
			"unreachable",
		);
		expect(init?.redirect).toBe("manual");
		expect(init?.signal).toBeDefined();
	});
	it("lockBase reaches a wildcard bind over loopback", () => {
		expect(lockBase({ host: "0.0.0.0", port: 6473 })).toBe(
			"http://127.0.0.1:6473",
		);
		expect(lockBase({ port: 3001 })).toBe("http://127.0.0.1:3001");
		expect(lockBase({ host: "::1", port: 6473 })).toBe("http://[::1]:6473");
	});
});

describe("pairRefusal", () => {
	const lock = { pid: 1, port: 6473 };
	const byUrl =
		(map: Record<string, typeof fetch>): typeof fetch =>
		((u: string, i: RequestInit) =>
			(map[new URL(u).host] ?? refused)(u, i)) as unknown as typeof fetch;
	const local = answering(200, { instanceId: ID });

	it("pairs when the local server is ours and no address is given", async () => {
		expect(
			await pairRefusal(
				{ lock, instanceId: ID, address: null },
				{ isAlive: alive, fetchImpl: local },
			),
		).toBeNull();
	});
	it("refuses when the local port answers a different instance", async () => {
		expect(
			await pairRefusal(
				{ lock, instanceId: ID, address: null },
				{ isAlive: alive, fetchImpl: answering(200, { instanceId: OTHER }) },
			),
		).toMatch(/different PrismaLens/);
	});
	it("refuses an unreachable --address with the reason", async () => {
		const msg = await pairRefusal(
			{ lock, instanceId: ID, address: "http://192.168.1.5:6473" },
			{ isAlive: alive, fetchImpl: byUrl({ "127.0.0.1:6473": local }) },
		);
		expect(msg).toMatch(/192\.168\.1\.5:6473 did not answer \(ECONNREFUSED\)/);
	});
	it("refuses a 403 --address and prints the allowed-hosts line", async () => {
		const msg = await pairRefusal(
			{ lock, instanceId: ID, address: "http://box.tailnet.ts.net:6473" },
			{
				isAlive: alive,
				fetchImpl: byUrl({
					"127.0.0.1:6473": local,
					"box.tailnet.ts.net:6473": answering(403),
				}),
			},
		);
		expect(msg).toContain("PRISMALENS_ALLOWED_HOSTS=box.tailnet.ts.net");
	});
	it("refuses a --address that is a different instance", async () => {
		const msg = await pairRefusal(
			{ lock, instanceId: ID, address: "http://10.0.0.2:6473" },
			{
				isAlive: alive,
				fetchImpl: byUrl({
					"127.0.0.1:6473": local,
					"10.0.0.2:6473": answering(200, { instanceId: OTHER }),
				}),
			},
		);
		expect(msg).toMatch(/different PrismaLens/);
	});
	describe("tailnet name this machine cannot resolve", () => {
		const address = "https://box.tailnet.ts.net";
		const notFound = (async () => {
			throw Object.assign(new TypeError("fetch failed"), {
				cause: { code: "ENOTFOUND" },
			});
		}) as unknown as typeof fetch;
		const fetchImpl = byUrl({ "127.0.0.1:6473": local, "box.tailnet.ts.net": notFound });

		it("pairs through the serve route, asking the local server as the tailnet name", async () => {
			const hosts: string[] = [];
			const warnings: string[] = [];
			const msg = await pairRefusal(
				{ lock, instanceId: ID, address, served: true },
				{
					isAlive: alive,
					fetchImpl,
					withHost: (host) => {
						hosts.push(host);
						return local;
					},
					onWarn: (w) => warnings.push(w),
				},
			);
			expect(msg).toBeNull();
			expect(hosts).toEqual(["box.tailnet.ts.net"]);
			expect(warnings[0]).toMatch(/can't resolve box\.tailnet\.ts\.net/);
		});
		it("still refuses when the server rejects the tailnet name", async () => {
			const msg = await pairRefusal(
				{ lock, instanceId: ID, address, served: true },
				{ isAlive: alive, fetchImpl, withHost: () => answering(403) },
			);
			expect(msg).toContain("PRISMALENS_ALLOWED_HOSTS=box.tailnet.ts.net");
		});
		it("refuses on ENOTFOUND for an address tailscale serve doesn't map", async () => {
			const msg = await pairRefusal(
				{ lock, instanceId: ID, address },
				{ isAlive: alive, fetchImpl, withHost: () => local },
			);
			expect(msg).toMatch(/did not answer \(ENOTFOUND\)/);
		});
	});
	it("fetchWithHost sends the Host header fetch() would drop", async () => {
		const server = createServer((req, res) => {
			res.end(JSON.stringify({ instanceId: req.headers.host === "box.ts.net" ? ID : OTHER }));
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		const { port } = server.address() as AddressInfo;
		try {
			expect(
				await probeInstance(`http://127.0.0.1:${port}`, ID, {
					fetchImpl: fetchWithHost("box.ts.net"),
				}),
			).toEqual({ kind: "ok" });
		} finally {
			server.close();
		}
	});
	it("refuses a workspace with no instance file", async () => {
		expect(
			await pairRefusal({ lock, instanceId: null, address: null }),
		).toMatch(/instance\.json/);
	});
});

describe("service status running line", () => {
	it("says yes only for the identity ok", () => {
		expect(runningLine({ kind: "ok" }, "http://127.0.0.1:6473", 42)).toBe(
			"yes (pid 42)",
		);
		expect(runningLine({ kind: "not-running" }, "x", null)).toBe("no");
		expect(
			runningLine(
				{ kind: "different-instance", instanceId: null },
				"http://127.0.0.1:6473",
				42,
			),
		).toMatch(/^no: .*different PrismaLens/);
	});
});
