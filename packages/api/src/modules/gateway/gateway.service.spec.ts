// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import runInvestigationJob from "../../infrastructure/dispatch/investigation-run.js";
import type { RunPorts } from "../../infrastructure/dispatch/run-ports.js";
import { GatewayService } from "./gateway.service.js";

const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "22222222-2222-4222-8222-222222222222";
const NAME = "prismalens-abcdefgh23";

const EMPTY = {
	connection: { findMany: async () => [] },
	setting: { findUnique: async () => null },
	serviceRepository: { count: async () => 0 },
	investigation: { findUnique: async () => null },
};

function gateway(
	prisma: Record<string, unknown> = EMPTY,
	listening = "::",
) {
	const http = {
		httpAdapter: {
			getHttpServer: () => ({
				address: () => ({ address: listening, family: "IPv6", port: 3001 }),
			}),
		},
	};
	return new GatewayService(prisma as never, http as never);
}

let id = 0;
function rpc(
	runId: string,
	method: string,
	params: Record<string, unknown> = {},
	token?: string,
): Request {
	return new Request(`http://gateway/api/mcp/runs/${runId}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": "2025-06-18",
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
	});
}

const initialize = {
	protocolVersion: "2025-06-18",
	capabilities: {},
	clientInfo: { name: "test", version: "0" },
};

async function body(res: Response): Promise<Record<string, unknown>> {
	const text = await res.text();
	const data = text.startsWith("{")
		? text
		: (text.split("\n").find((l) => l.startsWith("data: "))?.slice(6) ?? "{}");
	return JSON.parse(data);
}

describe("gateway bearer (#848)", () => {
	it("leases a loopback URL on the run's own path", async () => {
		const entry = await gateway().lease(RUN_A, NAME);
		expect(entry?.url).toBe(`http://127.0.0.1:3001/api/mcp/runs/${RUN_A}`);
		expect(entry?.token.length).toBeGreaterThan(30);
	});

	it("keeps an IPv6 loopback listener reachable at [::1]", async () => {
		const entry = await gateway(EMPTY, "::1").lease(RUN_A, NAME);
		expect(entry?.url).toBe(`http://[::1]:3001/api/mcp/runs/${RUN_A}`);
	});

	it("401 with no bearer", async () => {
		const g = gateway();
		await g.lease(RUN_A, NAME);
		const res = await g.serve(RUN_A, rpc(RUN_A, "initialize", initialize));
		expect(res.status).toBe(401);
	});

	it("401 with a wrong bearer", async () => {
		const g = gateway();
		await g.lease(RUN_A, NAME);
		const res = await g.serve(
			RUN_A,
			rpc(RUN_A, "initialize", initialize, "not-the-token"),
		);
		expect(res.status).toBe(401);
	});

	it("401 for run A's token on run B's path", async () => {
		const g = gateway();
		const a = await g.lease(RUN_A, NAME);
		await g.lease(RUN_B, NAME);
		const res = await g.serve(
			RUN_B,
			rpc(RUN_B, "initialize", initialize, a?.token),
		);
		expect(res.status).toBe(401);
	});

	it("401 for a token after its run ended", async () => {
		const g = gateway();
		const a = await g.lease(RUN_A, NAME);
		const ok = await g.serve(
			RUN_A,
			rpc(RUN_A, "initialize", initialize, a?.token),
		);
		expect(ok.status).toBe(200);
		g.revoke(RUN_A);
		const res = await g.serve(
			RUN_A,
			rpc(RUN_A, "initialize", initialize, a?.token),
		);
		expect(res.status).toBe(401);
	});

	it("a new lease (a follow-up's session/load) retires the old token", async () => {
		const g = gateway();
		const first = await g.lease(RUN_A, NAME);
		const second = await g.lease(RUN_A, NAME);
		expect(
			(await g.serve(RUN_A, rpc(RUN_A, "initialize", initialize, first?.token)))
				.status,
		).toBe(401);
		expect(
			(
				await g.serve(
					RUN_A,
					rpc(RUN_A, "initialize", initialize, second?.token),
				)
			).status,
		).toBe(200);
	});

	it("a run revokes its bearer when it fails before the agent starts", async () => {
		const revoke = vi.fn();
		const ports = new Proxy(
			{ gateway: { lease: vi.fn(async () => null), revoke } },
			{
				get: (target, key) =>
					key in target
						? target[key as keyof typeof target]
						: vi.fn(async () => null),
			},
		) as unknown as RunPorts;
		await expect(
			runInvestigationJob(
				{ id: "j1", investigationId: RUN_A, attempts: 1 },
				{ investigationId: RUN_A } as never,
				{
					emit: () => {},
					streamDone: () => {},
					signal: new AbortController().signal,
				},
				ports,
			),
		).rejects.toThrow();
		expect(revoke).toHaveBeenCalledWith(RUN_A);
	});
});

describe("gateway tools (#848 ruling 2026-10-24)", () => {
	const investigation = {
		findUnique: vi.fn(async () => ({
			workspace: null,
			incident: {
				number: 12,
				title: "checkout errors",
				status: "investigating",
				severity: "high",
				description: null,
				triggeredAt: new Date("2026-10-24T09:00:00Z"),
				service: { name: "checkout" },
				alerts: [
					{
						title: "HighErrorRate",
						severity: "high",
						labels: '{"alertname":"HighErrorRate"}',
						triggeredAt: new Date("2026-10-24T09:00:00Z"),
					},
				],
			},
		})),
		findMany: vi.fn(async () => [
			{
				id: RUN_B,
				completedAt: new Date("2026-10-18T10:00:00Z"),
				summary: "checkout 500s",
				rootCause: "pool exhausted",
				rootCauseCategory: "config",
				incident: {
					number: 7,
					title: "checkout errors",
					actualCause: "bad deploy",
					actualCauseCategory: "code",
					service: { name: "checkout" },
				},
			},
		]),
	};
	const incident = { findUnique: vi.fn(async () => null) };

	async function call(
		method: string,
		params: Record<string, unknown> = {},
	): Promise<Record<string, unknown>> {
		const g = gateway({
			investigation,
			incident,
			changeEvent: { findMany: async () => [] },
			setting: { findUnique: async () => null },
		});
		const entry = await g.lease(RUN_A, NAME);
		const res = await g.serve(RUN_A, rpc(RUN_A, method, params, entry?.token));
		expect(res.status).toBe(200);
		return body(res);
	}
	const text = (out: Record<string, unknown>) =>
		(out.result as { content: { text: string }[] }).content[0]?.text as string;

	it("carries only PrismaLens's harness tools, all read-only: no data-access tool, no vendor proxy", async () => {
		const out = await call("tools/list");
		const tools = (
			out.result as {
				tools: { name: string; annotations?: { readOnlyHint?: boolean } }[];
			}
		).tools;
		expect(tools.map((t) => t.name).sort()).toEqual([
			"incident_get",
			"investigations_search",
			"runbooks_list",
			"runbooks_read",
		]);
		expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
	});

	it("the lease names the same tools, and the prompt line sends data access to the agent's own tools", async () => {
		const entry = await gateway().lease(RUN_A, NAME);
		expect([...(entry?.tools ?? [])].sort()).toEqual([
			"incident_get",
			"investigations_search",
			"runbooks_list",
			"runbooks_read",
		]);
		expect(entry?.promptLine).toContain("use the tools your own setup gives you");
		expect(entry?.promptLine).not.toMatch(/prometheus|loki|alertmanager|sources_list/);
	});

	it("toolsServer: lease carries the given serverName in the prompt line and entry", async () => {
		const entry = await gateway().lease(RUN_A, "prismalens-customname12");
		expect(entry?.serverName).toBe("prismalens-customname12");
		expect(entry?.promptLine).toContain("MCP server `prismalens-customname12`");
	});

	for (const name of ["prometheus_query", "loki_query_range", "alertmanager_alerts", "sources_list", "vendor__tool"])
		it(`${name} is not a tool any more`, async () => {
			const out = await call("tools/call", { name, arguments: {} });
			const failed =
				out.error !== undefined ||
				(out.result as { isError?: boolean } | undefined)?.isError === true;
			expect(failed).toBe(true);
		});

	it("incident_get without a number returns the run's own incident with its alerts", async () => {
		const got = JSON.parse(
			text(await call("tools/call", { name: "incident_get", arguments: {} })),
		);
		expect(got).toMatchObject({
			number: 12,
			service: "checkout",
			alerts: [{ title: "HighErrorRate", labels: { alertname: "HighErrorRate" } }],
		});
		expect(investigation.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: RUN_A } }),
		);
	});

	it("incident_get by a number that does not exist is an error", async () => {
		const out = await call("tools/call", { name: "incident_get", arguments: { number: 99 } });
		expect((out.result as { isError?: boolean }).isError).toBe(true);
		expect(incident.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { number: 99 } }),
		);
	});

	it("investigations_search keeps the operator's recorded cause apart and never returns this run", async () => {
		const out = await call("tools/call", {
			name: "investigations_search",
			arguments: { query: "checkout", limit: 3 },
		});
		const [hit] = JSON.parse(text(out));
		expect(hit.agentFinding.rootCause).toBe("pool exhausted");
		expect(hit.operatorRecordedCause).toEqual({
			cause: "bad deploy",
			category: "code",
		});
		const where = (
			investigation.findMany.mock.calls.at(-1) as unknown as [
				{ where: { id: unknown }; take: number },
			]
		)[0];
		expect(where.where.id).toEqual({ not: RUN_A });
		expect(where.take).toBe(3);
	});

	it("investigations_search refuses a limit over 20", async () => {
		const out = await call("tools/call", {
			name: "investigations_search",
			arguments: { query: "x", limit: 21 },
		});
		const failed =
			out.error !== undefined ||
			(out.result as { isError?: boolean } | undefined)?.isError === true;
		expect(failed).toBe(true);
	});
});
