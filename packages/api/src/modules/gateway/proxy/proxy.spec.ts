// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createMcpHandler, Server } from "@modelcontextprotocol/server";
import type { SourceCredential } from "@prismalens/contracts/schemas";
import { describe, expect, it } from "vitest";
import { McpProxy } from "./proxy.service.js";
import { LIMITS } from "./snapshot.js";
import type { McpConnection } from "./upstream.js";

const TOKEN = "vendor-secret-token-123";

interface FakeTool {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
	annotations?: Record<string, unknown>;
}

interface Fake {
	host: string;
	tools: FakeTool[];
	pageSize?: number;
	calls: { name: string; auth: string | null }[];
	pages: number;
	requests: { url: string; auth: string | null }[];
	down?: boolean;
	/** Answer every request with this instead of MCP. */
	raw?: () => Response;
	result?: (name: string) => unknown;
	/** tools/list waits for this before answering. */
	holdList?: Promise<void>;
	/** tools/list always answers an empty page with this cursor. */
	stuckCursor?: string;
}

function fake(host: string, tools: FakeTool[], o: Partial<Fake> = {}): Fake {
	return { host, tools, calls: [], pages: 0, requests: [], ...o };
}

const tool = (name: string, extra: Partial<FakeTool> = {}): FakeTool => ({
	name,
	description: `does ${name}`,
	inputSchema: { type: "object", properties: { q: { type: "string" } } },
	...extra,
});

function serve(f: Fake) {
	let auth: string | null = null;
	const handler = createMcpHandler(
		() => {
			const s = new Server(
				{ name: f.host, version: "1" },
				{ capabilities: { tools: {} } },
			);
			s.setRequestHandler("tools/list", async (req) => {
				f.pages++;
				if (f.holdList) await f.holdList;
				if (f.stuckCursor) return { tools: [], nextCursor: f.stuckCursor } as never;
				const size = f.pageSize ?? f.tools.length;
				const start = Number(req.params?.cursor ?? 0);
				const next = start + size;
				return {
					tools: f.tools.slice(start, next),
					...(next < f.tools.length ? { nextCursor: String(next) } : {}),
				} as never;
			});
			s.setRequestHandler("tools/call", async (req) => {
				f.calls.push({ name: req.params.name, auth });
				return (f.result?.(req.params.name) ?? {
					content: [{ type: "text", text: `${f.host}:${req.params.name}` }],
				}) as never;
			});
			return s;
		},
		{ responseMode: "json" },
	);
	return async (req: Request) => {
		auth = req.headers.get("authorization");
		return handler.fetch(req);
	};
}

function router(fakes: Fake[]): typeof fetch {
	const handlers = new Map(fakes.map((f) => [f.host, serve(f)]));
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const req = new Request(input, init);
		const url = new URL(req.url);
		const f = fakes.find((x) => x.host === url.host);
		f?.requests.push({ url: req.url, auth: req.headers.get("authorization") });
		if (!f || f.down) throw new TypeError("fetch failed");
		if (f.raw) return f.raw();
		return (handlers.get(f.host) as (r: Request) => Promise<Response>)(req);
	}) as typeof fetch;
}

function conn(name: string, host: string, credential?: SourceCredential): McpConnection {
	const c: SourceCredential = credential ?? { kind: "bearer", token: TOKEN };
	return {
		id: `id-${name}`,
		name,
		description: `${name} instance`,
		url: `https://${host}/mcp`,
		credential: c,
		connection: { id: `id-${name}`, load: async () => c, save: async () => {} },
	};
}

function proxyOf(fakes: Fake[], conns: McpConnection[], removed: string[] = []) {
	const prisma = {
		connection: {
			findUnique: async ({ where }: { where: { id: string } }) =>
				removed.includes(where.id) ? null : { status: "ACTIVE" },
		},
	};
	const p = new McpProxy(prisma as never, {} as never, {} as never);
	p.fetchImpl = router(fakes);
	p.connections = async () =>
		[...conns].sort((a, b) => (a.name < b.name ? -1 : 1));
	return p;
}

const signal = () => new AbortController().signal;
const text = (r: { content: unknown[] }) =>
	(r.content as { text?: string }[]).map((c) => c.text ?? "").join("");

describe("McpProxy (#848, 06)", () => {
	it("lists both instances under their own prefix and reaches the right server", async () => {
		const prod = fake("prod.n8n.test", [tool("list_workflows")]);
		const staging = fake("staging.n8n.test", [tool("list_workflows")]);
		const p = proxyOf([prod, staging], [
			conn("n8n_prod", prod.host),
			conn("n8n_staging", staging.host),
		]);
		const snap = await p.snapshot("run-1", 5000);
		expect(snap.connections.map((c) => [c.name, c.description, c.tools.map((t) => t.offered)])).toEqual([
			["n8n_prod", "n8n_prod instance", ["n8n_prod__list_workflows"]],
			["n8n_staging", "n8n_staging instance", ["n8n_staging__list_workflows"]],
		]);
		const r = await p.call("run-1", "n8n_staging__list_workflows", {}, signal());
		expect(text(r)).toBe("staging.n8n.test:list_workflows");
		expect(staging.calls).toEqual([{ name: "list_workflows", auth: `Bearer ${TOKEN}` }]);
		expect(prod.calls).toHaveLength(0);
		p.close("run-1");
	});

	it("never forwards a vendor's readOnlyHint or other annotations", async () => {
		const s = fake("a.test", [tool("read", { annotations: { readOnlyHint: true } })]);
		const snap = await proxyOf([s], [conn("a", s.host)]).snapshot("r", 5000);
		expect(Object.keys(snap.connections[0]?.tools[0] ?? {}).sort()).toEqual([
			"description",
			"inputSchema",
			"offered",
			"upstream",
		]);
	});

	it("refuses a redirect to another origin; the other origin never sees the token", async () => {
		const evil = fake("evil.test", []);
		const s = fake("a.test", [], {
			raw: () =>
				new Response(null, {
					status: 307,
					headers: { location: "https://evil.test/mcp" },
				}),
		});
		const snap = await proxyOf([s, evil], [conn("a", s.host)]).snapshot("r", 5000);
		expect(snap.connections[0]).toMatchObject({ status: "unreachable", tools: [] });
		expect(evil.requests).toHaveLength(0);
	});

	it("a removed connection answers removed", async () => {
		const s = fake("a.test", [tool("t")]);
		const p = proxyOf([s], [conn("a", s.host)], ["id-a"]);
		await p.snapshot("r", 5000);
		const r = await p.call("r", "a__t", {}, signal());
		expect(r).toMatchObject({ isError: true });
		expect(text(r)).toBe("This MCP connection was removed");
		expect(s.calls).toHaveLength(0);
	});

	it("a server that is down is unreachable and the run continues", async () => {
		const up = fake("up.test", [tool("t")]);
		const down = fake("down.test", [tool("t")], { down: true });
		const snap = await proxyOf([up, down], [conn("a", up.host), conn("b", down.host)]).snapshot("r", 5000);
		expect(snap.connections.map((c) => c.status)).toEqual(["connected", "unreachable"]);
	});

	it("an HTTP 500 body holding the token never reaches the agent; a tool's own isError does", async () => {
		const s = fake("a.test", [tool("boom"), tool("fails")], {
			result: (n) =>
				n === "fails"
					? { isError: true, content: [{ type: "text", text: "workflow not found" }] }
					: undefined,
		});
		const p = proxyOf([s], [conn("a", s.host)]);
		await p.snapshot("r", 5000);
		const own = await p.call("r", "a__fails", {}, signal());
		expect(own).toEqual({ isError: true, content: [{ type: "text", text: "workflow not found" }] });
		s.raw = () => new Response(`internal error, token=${TOKEN}`, { status: 500 });
		const r = await p.call("r", "a__boom", {}, signal());
		expect(r.isError).toBe(true);
		expect(JSON.stringify(r)).not.toContain(TOKEN);
		expect(text(r)).toMatch(/^a: /);
	});

	it("forwards images and tool metadata byte for byte", async () => {
		const image = { type: "image", data: Buffer.from([1, 2, 3, 250]).toString("base64"), mimeType: "image/png" };
		const s = fake("a.test", [tool("img")], {
			result: () => ({ content: [image], structuredContent: { n: 1 }, _meta: { k: "v" } }),
		});
		const p = proxyOf([s], [conn("a", s.host)]);
		await p.snapshot("r", 5000);
		const r = await p.call("r", "a__img", {}, signal());
		expect(r.content).toEqual([image]);
		expect(r.structuredContent).toEqual({ n: 1 });
	});

	it("live status: stopping a server flips ping to unreachable with no call between", async () => {
		const s = fake("a.test", [tool("t")]);
		const p = proxyOf([s], [conn("a", s.host)]);
		await p.snapshot("r", 5000);
		expect(await p.ping("r", "id-a", 2000)).toEqual({ ok: true });
		s.down = true;
		expect((await p.ping("r", "id-a", 2000)).ok).toBe(false);
	});
});

describe("McpProxy discovery bounds (OBJ-019)", () => {
	const many = (n: number, prefix = "t") =>
		Array.from({ length: n }, (_, i) => tool(`${prefix}${String(i).padStart(3, "0")}`));

	it("a server with 310 tools offers 64 and reports the 246 dropped", async () => {
		const s = fake("a.test", many(310));
		const snap = await proxyOf([s], [conn("a", s.host)]).snapshot("r", 5000);
		const c = snap.connections[0];
		expect(c?.tools).toHaveLength(64);
		expect(c?.dropped).toEqual([{ count: 246, why: "tool-count" }]);
	});

	it("paging stops after the page that reached 64", async () => {
		const s = fake("a.test", many(310), { pageSize: 50 });
		await proxyOf([s], [conn("a", s.host)]).snapshot("r", 5000);
		expect(s.pages).toBe(2);
	});

	it("drops a single tool over 16 KB", async () => {
		const big = tool("big", { description: "x".repeat(20 * 1024) });
		const s = fake("a.test", [big, tool("small")]);
		const c = (await proxyOf([s], [conn("a", s.host)]).snapshot("r", 5000)).connections[0];
		expect(c?.tools.map((t) => t.upstream)).toEqual(["small"]);
		expect(c?.dropped).toEqual([{ count: 1, why: "schema-bytes" }]);
	});

	it("four servers of 64 tools stop at 192 in total", async () => {
		const fakes = ["a", "b", "c", "d"].map((n) => fake(`${n}.test`, many(64)));
		const snap = await proxyOf(fakes, fakes.map((f) => conn(f.host[0] ?? "x", f.host))).snapshot("r", 5000);
		expect(snap.connections.reduce((n, c) => n + c.tools.length, 0)).toBe(LIMITS.proxy.toolsPerRun);
		expect(snap.connections[3]?.dropped).toEqual([{ count: 64, why: "total-tools" }]);
	});

	it("40 servers of one 15 KB tool stop at the 512 KB run budget", async () => {
		const fakes = Array.from({ length: 40 }, (_, i) =>
			fake(`s${i}.test`, [tool("t", { description: "x".repeat(15 * 1024) })]),
		);
		const conns = fakes.map((f, i) => conn(`s${String(i).padStart(2, "0")}`, f.host));
		const snap = await proxyOf(fakes, conns).snapshot("r", 10_000);
		const kept = snap.connections.reduce((n, c) => n + c.tools.length, 0);
		expect(kept).toBeGreaterThan(30);
		expect(kept).toBeLessThan(40);
		expect(snap.connections.at(-1)?.dropped).toEqual([{ count: 1, why: "total-bytes" }]);
	});

	it("a 5 MB tool page is cut at 1 MB before parsing; the others continue", async () => {
		const huge = fake("huge.test", [], {
			raw: () => {
				let sent = 0;
				return new Response(
					new ReadableStream({
						pull(ctl) {
							if (sent >= 5 * 1024 * 1024) return ctl.close();
							sent += 64 * 1024;
							ctl.enqueue(new Uint8Array(64 * 1024).fill(32));
						},
					}),
					{ headers: { "content-type": "application/json" } },
				);
			},
		});
		const ok = fake("ok.test", [tool("t")]);
		const snap = await proxyOf([huge, ok], [conn("a", huge.host), conn("b", ok.host)]).snapshot("r", 5000);
		expect(snap.connections[0]).toMatchObject({ status: "unreachable" });
		expect(snap.connections[1]?.tools).toHaveLength(1);
	});
});

describe("McpProxy r4 findings", () => {
	it("scrubs a credential echoed in an embedded text resource, keeping the resource (OBJ-024)", async () => {
		const s = fake("a.test", [tool("res")], {
			result: () => ({
				content: [
					{
						type: "resource",
						resource: { uri: "file:///x", mimeType: "text/plain", text: `key=${TOKEN}` },
					},
				],
			}),
		});
		const p = proxyOf([s], [conn("a", s.host)]);
		await p.snapshot("r", 5000);
		const r = await p.call("r", "a__res", {}, signal());
		expect(JSON.stringify(r)).not.toContain(TOKEN);
		expect(r.content[0]).toMatchObject({
			type: "resource",
			resource: { uri: "file:///x", text: "key=[redacted]" },
		});
	});

	it("discovery's 2 MB budget does not cap later calls or pings (OBJ-027)", async () => {
		const big = "x".repeat(768 * 1024);
		const s = fake("a.test", [tool("big")], {
			result: () => ({ content: [{ type: "text", text: big }] }),
		});
		const p = proxyOf([s], [conn("a", s.host)]);
		await p.snapshot("r", 5000);
		for (let i = 0; i < 4; i++) {
			const r = await p.call("r", "a__big", {}, signal());
			expect(r.isError).toBeUndefined();
		}
		expect(await p.ping("r", "id-a", 2000)).toEqual({ ok: true });
	});

	it("measures definitions in UTF-8 bytes: 15,000 CJK characters exceed 16 KB (OBJ-033)", async () => {
		const s = fake("a.test", [tool("cjk", { description: "界".repeat(15_000) }), tool("small")]);
		const c = (await proxyOf([s], [conn("a", s.host)]).snapshot("r", 5000)).connections[0];
		expect(c?.tools.map((t) => t.upstream)).toEqual(["small"]);
		expect(c?.dropped).toEqual([{ count: 1, why: "schema-bytes" }]);
	});

	it("a first page of exactly 64 tools with a next cursor still reports truncation (OBJ-034)", async () => {
		const s = fake(
			"a.test",
			Array.from({ length: 100 }, (_, i) => tool(`t${String(i).padStart(3, "0")}`)),
			{ pageSize: 64 },
		);
		const c = (await proxyOf([s], [conn("a", s.host)]).snapshot("r", 5000)).connections[0];
		expect(s.pages).toBe(1);
		expect(c?.tools).toHaveLength(64);
		expect(c?.dropped?.[0]?.why).toBe("tool-count");
		expect(c?.dropped?.[0]?.count).toBeGreaterThan(0);
	});
});

describe("McpProxy paging bounds", () => {
	it("stops on a repeated cursor and reports the unseen rest as dropped", async () => {
		const s = fake("a.test", [], { stuckCursor: "same" });
		const c = (await proxyOf([s], [conn("a", s.host)]).snapshot("r", 5000)).connections[0];
		expect(s.pages).toBe(2);
		expect(c?.dropped).toEqual([{ count: 1, why: "received-bytes" }]);
	});

	it("stops at 32 pages when every cursor is new", async () => {
		const s = fake(
			"a.test",
			Array.from({ length: 200 }, (_, i) => tool(`t${String(i).padStart(3, "0")}`)),
			{ pageSize: 1 },
		);
		const c = (await proxyOf([s], [conn("a", s.host)]).snapshot("r", 5000)).connections[0];
		expect(s.pages).toBe(32);
		expect(c?.tools).toHaveLength(32);
		expect(c?.dropped?.[0]?.why).toBe("received-bytes");
	});
});

describe("McpProxy duplicate names (OBJ-026)", () => {
	it("a second connection with a taken name offers nothing; calls reach only the first", async () => {
		const prod = fake("prod.test", [tool("t")]);
		const staging = fake("staging.test", [tool("t")]);
		const a = conn("n8n_prod", prod.host);
		const b = { ...conn("n8n_prod", staging.host), id: "id-other" };
		const p = proxyOf([prod, staging], [a, b]);
		const snap = await p.snapshot("r", 5000);
		expect(snap.connections.map((c) => [c.id, c.status, c.tools.length])).toEqual([
			["id-n8n_prod", "connected", 1],
			["id-other", "unreachable", 0],
		]);
		await p.call("r", "n8n_prod__t", {}, signal());
		expect(prod.calls).toHaveLength(1);
		expect(staging.calls).toHaveLength(0);
	});
});

describe("McpProxy discovery isolation (OBJ-037)", () => {
	it("a catalogue that stalls past the budget does not take a healthy later one with it", async () => {
		let release = () => {};
		const stalled = fake("a.test", [tool("t")], {
			holdList: new Promise<void>((r) => {
				release = r;
			}),
		});
		const healthy = fake("b.test", [tool("t")]);
		const p = proxyOf([stalled, healthy], [conn("a", stalled.host), conn("b", healthy.host)]);
		const started = Date.now();
		const snap = await p.snapshot("r", 500);
		const elapsed = Date.now() - started;
		release();
		expect(snap.connections.map((c) => [c.name, c.status, c.tools.length])).toEqual([
			["a", "unreachable", 0],
			["b", "connected", 1],
		]);
		expect(elapsed).toBeLessThan(1500);
	});
});
