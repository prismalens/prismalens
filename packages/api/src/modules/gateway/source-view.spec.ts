// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseSourceCredential } from "@prismalens/contracts/schemas";
import type { ProxyPort, ProxySnapshot } from "@prismalens/integrations";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayService } from "./gateway.service.js";

const RUN = "44444444-4444-4444-8444-444444444444";

interface Row {
	id: string;
	label: string;
	templateId: string;
	baseUrl?: string;
	status?: string;
	lastErrorMessage?: string;
}

const servers: Server[] = [];
afterEach(async () => {
	await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function prometheus(): Promise<string> {
	const server = createServer((_req, res) => {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ status: "success", data: { resultType: "vector", result: [] } }));
	});
	servers.push(server);
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function setup(rows: Row[], proxy?: Partial<ProxyPort>) {
	const prisma = {
		setting: { findUnique: async () => null },
		serviceRepository: { count: async () => 0 },
		investigation: { findUnique: async () => null },
		connection: {
			findMany: async () =>
				rows.map((r) => ({
					id: r.id,
					label: r.label,
					status: r.status ?? "ACTIVE",
					lastErrorAt: null,
					lastErrorMessage: r.lastErrorMessage ?? null,
					integration: { templateId: r.templateId, label: r.templateId },
				})),
		},
	};
	const integrations = {
		connectionBaseUrl: async (id: string) => rows.find((r) => r.id === id)?.baseUrl ?? null,
		sourceCredential: async () => parseSourceCredential({}),
	};
	const http = {
		httpAdapter: {
			getHttpServer: () => ({
				address: () => ({ address: "127.0.0.1", family: "IPv4", port: 3001 }),
			}),
		},
	};
	const port: ProxyPort = {
		snapshot: async () => ({ connections: [] }),
		ping: async () => ({ ok: true }),
		call: async () => ({ content: [] }),
		close: () => {},
		...proxy,
	};
	return new GatewayService(prisma as never, http as never, integrations as never, port);
}

let rpcId = 0;
async function tool(g: GatewayService, token: string, name: string, args: Record<string, unknown> = {}) {
	const res = await g.serve(
		RUN,
		new Request(`http://gateway/api/mcp/runs/${RUN}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				"mcp-protocol-version": "2025-06-18",
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: ++rpcId,
				method: "tools/call",
				params: { name, arguments: args },
			}),
		}),
	);
	const text = await res.text();
	const body = JSON.parse(
		text.startsWith("{")
			? text
			: (text.split("\n").find((l) => l.startsWith("data: "))?.slice(6) ?? "{}"),
	) as { result: { content: { text: string }[] } };
	return JSON.parse(body.result.content[0]?.text ?? "null");
}

type View = { category: string; status: string; howToConnect?: string; sources: { id: string; label: string; status: string; reason?: string }[] }[];
const category = (view: View, c: string) => view.find((v) => v.category === c);

describe("the view across a run (#848, OBJ-010)", () => {
	it("a connection deleted mid-run reads removed for that run", async () => {
		const rows: Row[] = [{ id: "p1", label: "prod prom", templateId: "prometheus" }];
		const g = setup(rows);
		const entry = await g.lease(RUN);
		rows.splice(0);
		const view = (await tool(g, entry?.token ?? "", "sources_list")) as View;
		expect(category(view, "metrics")?.sources).toContainEqual(
			expect.objectContaining({ id: "p1", label: "prod prom", status: "removed" }),
		);
		expect(category(view, "metrics")?.status).toBe("not-configured");
	});

	it("a connection added mid-run, used, then deleted reads removed by its label", async () => {
		const rows: Row[] = [];
		const g = setup(rows);
		const entry = await g.lease(RUN);
		const token = entry?.token ?? "";
		rows.push({ id: "p2", label: "late prom", templateId: "prometheus", baseUrl: await prometheus() });
		expect(await tool(g, token, "prometheus_query", { query: "up" })).toMatchObject({ source: "late prom" });
		rows.splice(0);
		expect(await tool(g, token, "prometheus_query", { query: "up" })).toMatchObject({ status: "not-configured" });
		const view = (await tool(g, token, "sources_list")) as View;
		expect(category(view, "metrics")?.sources).toContainEqual(
			expect.objectContaining({ id: "p2", label: "late prom", status: "removed" }),
		);
	});

	it("a vendor MCP server that stops mid-run reads unreachable on the next sources_list", async () => {
		let up = true;
		const snapshot: ProxySnapshot = {
			connections: [
				{ id: "m1", name: "n8n_prod", description: "production automations", status: "connected", tools: [] },
			],
		};
		const g = setup([{ id: "m1", label: "n8n_prod", templateId: "mcp-server" }], {
			snapshot: async () => snapshot,
			ping: async () => (up ? { ok: true } : { ok: false, reason: "the server did not answer" }),
		});
		const token = (await g.lease(RUN))?.token ?? "";
		const first = category((await tool(g, token, "sources_list")) as View, "mcp");
		expect(first?.sources[0]).toMatchObject({ name: "n8n_prod", status: "connected" });
		up = false;
		const next = category((await tool(g, token, "sources_list")) as View, "mcp");
		expect(next?.sources[0]).toMatchObject({ status: "unreachable", reason: "the server did not answer" });
	});

	it("a vendor MCP connection added mid-run is offered from the next run", async () => {
		const rows: Row[] = [];
		const g = setup(rows);
		const token = (await g.lease(RUN))?.token ?? "";
		rows.push({ id: "m2", label: "n8n_staging", templateId: "mcp-server" });
		const mcp = category((await tool(g, token, "sources_list")) as View, "mcp");
		expect(mcp?.sources[0]).toMatchObject({ status: "not-configured", reason: "available from the next run" });
	});

	it("with nothing connected a category says how to connect, naming no CLI verb", async () => {
		const g = setup([]);
		const token = (await g.lease(RUN))?.token ?? "";
		const view = (await tool(g, token, "sources_list")) as View;
		expect(category(view, "logs")).toMatchObject({
			status: "not-configured",
			howToConnect: "Connect one in PrismaLens under Settings, Data sources.",
		});
		expect(category(view, "deploys")?.howToConnect).toBe(
			"Send deploy events to POST /api/webhooks/deploy; see PrismaLens under Settings, Data sources.",
		);
		expect(JSON.stringify(view)).not.toMatch(/`pl |\bpl (connect|deploy|sources)\b/);
	});
});

describe("the prompt line (#848)", () => {
	it("lists reachable tools, fences the MCP servers, and names what is not connected", async () => {
		const g = setup([{ id: "m1", label: "n8n_prod", templateId: "mcp-server" }], {
			snapshot: async () => ({
				connections: [
					{
						id: "m1",
						name: "n8n_prod",
						description: "production automations",
						status: "connected",
						tools: [{ offered: "n8n_prod__list_workflows", upstream: "list_workflows", description: "", inputSchema: {} }],
					},
				],
			}),
		});
		const line = (await g.lease(RUN))?.promptLine ?? "";
		expect(line).toContain("PrismaLens tools (MCP server `prismalens`). `sources_list` shows what this run can reach now.");
		expect(line).toContain("knowledge: `investigations_search`, `runbooks_list`, `runbooks_read`");
		expect(line).toContain("`n8n_prod` (production automations, 1 tools)");
		expect(line).toContain("<<<MCP_SERVERS");
		expect(line).toContain("Not connected: metrics, logs, scm, deploys.");
	});
});

describe("proxied tools on the gateway (#848, 06 gateway half)", () => {
	const schema = { type: "object", properties: { id: { type: "string", pattern: "^w" } }, required: ["id"] };
	const snapshot: ProxySnapshot = {
		connections: [
			{
				id: "m1",
				name: "n8n_prod",
				description: "production automations",
				status: "connected",
				tools: [{ offered: "n8n_prod__get_workflow", upstream: "get_workflow", description: "Get one.", inputSchema: schema }],
			},
		],
	};

	async function rpc(g: GatewayService, token: string, method: string, params: Record<string, unknown>) {
		const res = await g.serve(
			RUN,
			new Request(`http://gateway/api/mcp/runs/${RUN}`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
					"mcp-protocol-version": "2025-06-18",
					authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
			}),
		);
		const text = await res.text();
		return JSON.parse(
			text.startsWith("{") ? text : (text.split("\n").find((l) => l.startsWith("data: "))?.slice(6) ?? "{}"),
		).result;
	}

	it("lists the vendor schema unconverted, prefixed, and never read-only", async () => {
		const g = setup([{ id: "m1", label: "n8n_prod", templateId: "mcp-server" }], { snapshot: async () => snapshot });
		const token = (await g.lease(RUN))?.token ?? "";
		const { tools } = await rpc(g, token, "tools/list", {});
		const proxied = tools.find((t: { name: string }) => t.name === "n8n_prod__get_workflow");
		expect(proxied).toEqual({
			name: "n8n_prod__get_workflow",
			description: "[n8n_prod: production automations] Get one.",
			inputSchema: schema,
			annotations: { readOnlyHint: false, openWorldHint: true },
		});
	});

	it("routes a __ name to the proxy and forwards an image unchanged", async () => {
		const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };
		const calls: string[] = [];
		const g = setup([{ id: "m1", label: "n8n_prod", templateId: "mcp-server" }], {
			snapshot: async () => snapshot,
			call: async (_run, offered) => {
				calls.push(offered);
				return { content: [image] };
			},
		});
		const token = (await g.lease(RUN))?.token ?? "";
		const out = await rpc(g, token, "tools/call", { name: "n8n_prod__get_workflow", arguments: { id: "w1" } });
		expect(calls).toEqual(["n8n_prod__get_workflow"]);
		expect(out.content).toEqual([image]);
	});
});

describe("follow-ups for lane B (#848)", () => {
	it("shows a sign-in that needs the user as the reason, and no other stored error", async () => {
		const g = setup([
			{ id: "s1", label: "gitlab", templateId: "gitlab-token", status: "ACTIVE", lastErrorMessage: "needs permission: read_api" },
			{ id: "s2", label: "bitbucket", templateId: "bitbucket-token", status: "REFRESH_FAILED", lastErrorMessage: "upstream said tok-123" },
			{ id: "s3", label: "github", templateId: "github-token", status: "ERROR", lastErrorMessage: "upstream said tok-456" },
			{ id: "m1", label: "n8n_prod", templateId: "mcp-server", lastErrorMessage: "needs permission: workflows:read" },
		]);
		const view = (await g.sources()) as unknown as View;
		const scm = category(view, "scm")?.sources ?? [];
		expect(scm.find((s) => s.id === "s1")?.reason).toBe("needs permission: read_api — sign in again");
		expect(scm.find((s) => s.id === "s2")?.reason).toBe("sign-in expired — sign in again");
		expect(scm.find((s) => s.id === "s3")?.reason).toBeUndefined();
		expect(JSON.stringify(view)).not.toContain("tok-");
		expect(category(view, "mcp")?.sources[0]?.reason).toBe("needs permission: workflows:read — sign in again");
	});

	it("an MCP connection deleted mid-run reads removed, decided by the view", async () => {
		const rows: Row[] = [{ id: "m1", label: "n8n_prod", templateId: "mcp-server" }];
		const g = setup(rows, {
			snapshot: async () => ({
				connections: [{ id: "m1", name: "n8n_prod", description: "prod", status: "connected", tools: [] }],
			}),
		});
		const token = (await g.lease(RUN))?.token ?? "";
		rows.splice(0);
		const mcp = category((await tool(g, token, "sources_list")) as View, "mcp");
		expect(mcp?.sources).toEqual([
			expect.objectContaining({ id: "m1", label: "n8n_prod", status: "removed" }),
		]);
	});
});
