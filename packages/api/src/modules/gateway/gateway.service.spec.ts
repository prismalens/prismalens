// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import runInvestigationJob from "../../infrastructure/dispatch/investigation-run.js";
import type { RunPorts } from "../../infrastructure/dispatch/run-ports.js";
import { GatewayService } from "./gateway.service.js";

const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "22222222-2222-4222-8222-222222222222";

function gateway(prisma: Record<string, unknown> = {}) {
	const http = {
		httpAdapter: {
			getHttpServer: () => ({
				address: () => ({ address: "::", family: "IPv6", port: 3001 }),
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
	it("leases a loopback URL on the run's own path", () => {
		const entry = gateway().lease(RUN_A);
		expect(entry?.url).toBe(`http://127.0.0.1:3001/api/mcp/runs/${RUN_A}`);
		expect(entry?.token.length).toBeGreaterThan(30);
	});

	it("401 with no bearer", async () => {
		const g = gateway();
		g.lease(RUN_A);
		const res = await g.serve(RUN_A, rpc(RUN_A, "initialize", initialize));
		expect(res.status).toBe(401);
	});

	it("401 with a wrong bearer", async () => {
		const g = gateway();
		g.lease(RUN_A);
		const res = await g.serve(
			RUN_A,
			rpc(RUN_A, "initialize", initialize, "not-the-token"),
		);
		expect(res.status).toBe(401);
	});

	it("401 for run A's token on run B's path", async () => {
		const g = gateway();
		const a = g.lease(RUN_A);
		g.lease(RUN_B);
		const res = await g.serve(
			RUN_B,
			rpc(RUN_B, "initialize", initialize, a?.token),
		);
		expect(res.status).toBe(401);
	});

	it("401 for a token after its run ended", async () => {
		const g = gateway();
		const a = g.lease(RUN_A);
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
		const first = g.lease(RUN_A);
		const second = g.lease(RUN_A);
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
			{ gateway: { lease: vi.fn(() => null), revoke } },
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

describe("gateway tools (#848)", () => {
	const connection = {
		findMany: vi.fn(async () => [
			{
				id: "c1",
				label: "prod prom",
				status: "ACTIVE",
				lastErrorAt: null,
				integration: { templateId: "prometheus", label: "Prometheus" },
			},
			{
				id: "c2",
				label: "",
				status: "CREDENTIALS_INVALID",
				lastErrorAt: new Date("2026-10-19T10:00:00Z"),
				integration: { templateId: "github-token", label: "GitHub" },
			},
		]),
	};
	const investigation = {
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

	async function call(
		method: string,
		params: Record<string, unknown> = {},
	): Promise<Record<string, unknown>> {
		const g = gateway({ connection, investigation });
		const entry = g.lease(RUN_A);
		const res = await g.serve(RUN_A, rpc(RUN_A, method, params, entry?.token));
		expect(res.status).toBe(200);
		return body(res);
	}

	it("tools/list returns exactly two read-only tools", async () => {
		const out = await call("tools/list");
		const tools = (
			out.result as {
				tools: { name: string; annotations?: { readOnlyHint?: boolean } }[];
			}
		).tools;
		expect(tools.map((t) => t.name).sort()).toEqual([
			"investigations_search",
			"sources_list",
		]);
		expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
	});

	it("an unknown tool is an error", async () => {
		const out = await call("tools/call", { name: "github_create_issue", arguments: {} });
		const failed =
			out.error !== undefined ||
			(out.result as { isError?: boolean } | undefined)?.isError === true;
		expect(failed).toBe(true);
	});

	it("sources_list names every category with its status", async () => {
		const out = await call("tools/call", { name: "sources_list", arguments: {} });
		const text = (out.result as { content: { text: string }[] }).content[0]
			?.text as string;
		const view = JSON.parse(text) as { category: string; status: string }[];
		expect(view.map((v) => [v.category, v.status])).toEqual([
			["metrics", "connected"],
			["logs", "not-configured"],
			["scm", "unreachable"],
			["deploys", "not-configured"],
			["knowledge", "connected"],
		]);
	});

	it("investigations_search keeps the operator's recorded cause apart and never returns this run", async () => {
		const out = await call("tools/call", {
			name: "investigations_search",
			arguments: { query: "checkout", limit: 3 },
		});
		const text = (out.result as { content: { text: string }[] }).content[0]
			?.text as string;
		const [hit] = JSON.parse(text);
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
