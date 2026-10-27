// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecordedFinding } from "@prismalens/contracts/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
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
				serviceId: "svc-1",
				triggeredAt: new Date("2026-10-24T09:00:00Z"),
				service: { name: "checkout" },
				alerts: [
					{
						title: "HighErrorRate",
						severity: "high",
						serviceId: "svc-1",
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
	const changeEvent = { findMany: vi.fn(async () => []) };
	const alert = { findMany: vi.fn(async () => [{ serviceId: "svc-1" }]) };

	async function call(
		method: string,
		params: Record<string, unknown> = {},
	): Promise<Record<string, unknown>> {
		const g = gateway({
			investigation,
			incident,
			changeEvent,
			alert,
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
			"evidence_record",
			"hypothesis_record",
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
			"evidence_record",
			"hypothesis_record",
			"incident_get",
			"investigations_search",
			"runbooks_list",
			"runbooks_read",
		]);
		expect(entry?.promptLine).toContain("use the tools your own setup gives you");
		expect(entry?.promptLine).toContain("`evidence_record`, quoting the output exactly");
		expect(entry?.promptLine).not.toMatch(/prometheus|loki|alertmanager|sources_list/);
	});

	it("toolsServer: lease carries the given serverName in the prompt line and entry", async () => {
		const entry = await gateway().lease(RUN_A, "prismalens-customname12");
		expect(entry?.serverName).toBe("prismalens-customname12");
		expect(entry?.promptLine).toContain("MCP server `prismalens-customname12`");
	});

	it("initialize then tools/list gives no calls, two tools/call fire onCall twice and calls() returns count: 2 (#848)", async () => {
		const g = gateway({
			investigation: {
				findUnique: vi.fn(async () => ({
					incident: { number: 1, service: { name: "checkout" }, alerts: [] },
				})),
			},
			incident: { findUnique: vi.fn(async () => null) },
			setting: { findUnique: async () => null },
		});
		const entry = await g.lease(RUN_A, NAME);
		const callsFired: { name: string; at: string }[] = [];
		entry?.onCall((c) => callsFired.push(c));

		await g.serve(RUN_A, rpc(RUN_A, "initialize", initialize, entry?.token));
		await g.serve(RUN_A, rpc(RUN_A, "tools/list", {}, entry?.token));
		expect(callsFired).toHaveLength(0);
		expect(entry?.calls()).toEqual([]);

		await g.serve(RUN_A, rpc(RUN_A, "tools/call", { name: "incident_get", arguments: {} }, entry?.token));
		await g.serve(RUN_A, rpc(RUN_A, "tools/call", { name: "incident_get", arguments: {} }, entry?.token));

		expect(callsFired).toHaveLength(2);
		expect(callsFired[0]?.name).toBe("incident_get");
		expect(callsFired[1]?.name).toBe("incident_get");
		const recorded = entry?.calls();
		expect(recorded).toHaveLength(1);
		expect(recorded?.[0]).toEqual({
			name: "incident_get",
			firstCalledAt: callsFired[0]?.at,
			count: 2,
		});
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

	it("incident_get changes: serves alerts and deploy and change events from the database (#848 C8)", async () => {
		const changeEvents = [
			{
				type: "deploy",
				source: "argocd",
				timestamp: new Date("2026-10-24T08:30:00Z"),
				description: "deployed checkout v2.1.0",
				metadata: JSON.stringify({ environment: "production", version: "v2.1.0" }),
				service: { name: "checkout" },
			},
			{
				type: "feature_flag",
				source: "launchdarkly",
				timestamp: new Date("2026-10-24T08:00:00Z"),
				description: "enabled new_cart",
				metadata: JSON.stringify({ env: "prod" }),
				service: { name: "checkout" },
			},
		];
		changeEvent.findMany.mockResolvedValueOnce(changeEvents as never);

		const res = await call("tools/call", { name: "incident_get", arguments: {} });
		const got = JSON.parse(text(res));

		expect(got.changes).toEqual([
			{
				type: "deploy",
				source: "argocd",
				timestamp: "2026-10-24T08:30:00.000Z",
				service: "checkout",
				description: "deployed checkout v2.1.0",
				environment: "production",
				version: "v2.1.0",
			},
			{
				type: "feature_flag",
				source: "launchdarkly",
				timestamp: "2026-10-24T08:00:00.000Z",
				service: "checkout",
				description: "enabled new_cart",
				environment: "prod",
				version: null,
			},
		]);

		const [callArg] = (changeEvent.findMany.mock.calls.at(-1) as unknown as [
			{ where: { serviceId: { in: string[] }; timestamp: { gte: Date; lte: Date } }; orderBy: { timestamp: string }; take: number },
		]);
		expect(callArg.where.serviceId).toEqual({ in: ["svc-1"] });
		expect(callArg.where.timestamp.gte).toEqual(new Date("2026-10-23T09:00:00.000Z"));
		expect(callArg.orderBy).toEqual({ timestamp: "desc" });
		expect(callArg.take).toBe(20);

		const listOut = await call("tools/list");
		const incidentGet = (listOut.result as { tools: { name: string; description: string }[] }).tools.find(
			(t) => t.name === "incident_get",
		);
		expect(incidentGet?.description).toContain("alerts, deploy and change events PrismaLens recorded");
	});

	it("alert.findMany returning a second service id makes changeEvent.findMany get both ids (#848)", async () => {
		alert.findMany.mockResolvedValueOnce([{ serviceId: "svc-1" }, { serviceId: "svc-2" }]);
		changeEvent.findMany.mockResolvedValueOnce([]);

		await call("tools/call", { name: "incident_get", arguments: {} });

		const [callArg] = (changeEvent.findMany.mock.calls.at(-1) as unknown as [
			{ where: { serviceId: { in: string[] } } },
		]);
		expect(callArg.where.serviceId.in).toEqual(expect.arrayContaining(["svc-1", "svc-2"]));
		expect(callArg.where.serviceId.in).toHaveLength(2);
	});
});

describe("recording evidence and hypotheses (#930)", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	});

	/** A live run whose workspace is a temp dir holding `repo/db.yaml`, with a file outside it. */
	async function live() {
		const root = mkdtempSync(join(tmpdir(), "pl-930-"));
		dirs.push(root);
		const cwd = join(root, "ws");
		mkdirSync(join(cwd, "repo"), { recursive: true });
		writeFileSync(join(cwd, "repo", "db.yaml"), "pool:\n  max: 50\n  idle: 5\n");
		writeFileSync(join(root, "secret.txt"), "max: 50\n");
		const workspace = JSON.stringify({ layout: "single", cwd, repos: [] });
		const g = gateway({
			...EMPTY,
			investigation: { findUnique: async () => ({ workspace }) },
		});
		const entry = await g.lease(RUN_A, NAME);
		if (!entry) throw new Error("no lease");
		const found: RecordedFinding[] = [];
		entry.onFinding?.((f) => found.push(f));
		const call = async (name: string, args: Record<string, unknown>) => {
			const res = await g.serve(
				RUN_A,
				rpc(RUN_A, "tools/call", { name, arguments: args }, entry.token),
			);
			if (res.status !== 200) throw new Error(`status ${res.status}`);
			const r = (await body(res)).result as {
				content: { text: string }[];
				isError?: boolean;
			};
			const text = r.content[0]?.text ?? "{}";
			return { isError: !!r.isError, text, value: JSON.parse(text) };
		};
		return { g, entry, found, call, root, cwd };
	}

	it("records evidence against a tool output the run saw, names the line, and never echoes the quote", async () => {
		const { entry, found, call } = await live();
		entry.sawOutput?.("toolu_1", "starting\nERROR pool exhausted: 50/50\n");
		const out = await call("evidence_record", {
			observation: "the pool is full",
			source: "kubectl logs api",
			quote: "ERROR pool exhausted",
		});
		expect(out.isError).toBe(false);
		expect(out.value).toEqual({
			id: "e1",
			anchor: { in: "tool-output", toolCallId: "toolu_1", line: 2 },
		});
		expect(out.text).not.toContain("ERROR pool exhausted");
		expect(found).toEqual([
			expect.objectContaining({
				type: "evidence",
				id: "e1",
				direction: "supports",
				quote: "ERROR pool exhausted",
			}),
		]);
	});

	it("a quote no output holds is recorded unanchored, with a note", async () => {
		const { call } = await live();
		const out = await call("evidence_record", {
			observation: "o",
			source: "s",
			quote: "never printed",
		});
		expect(out.value).toMatchObject({
			id: "e1",
			anchor: null,
			note: expect.stringContaining("unanchored"),
		});
	});

	it("resolves a quote in a workspace file to its line, relative or absolute", async () => {
		const { call, cwd } = await live();
		const rel = await call("evidence_record", {
			observation: "max 50",
			source: "config",
			quote: "max: 50",
			path: "repo/db.yaml",
		});
		expect(rel.value.anchor).toEqual({
			in: "file",
			path: join(cwd, "repo", "db.yaml"),
			line: 2,
		});
		const abs = await call("evidence_record", {
			observation: "idle",
			source: "config",
			quote: "idle: 5",
			path: join(cwd, "repo", "db.yaml"),
		});
		expect(abs.value.anchor).toMatchObject({ in: "file", line: 3 });
	});

	it("never reads a file outside the run's workspace", async () => {
		const { call, root } = await live();
		for (const path of ["../secret.txt", join(root, "secret.txt")]) {
			const out = await call("evidence_record", {
				observation: "o",
				source: "s",
				quote: "max: 50",
				path,
			});
			expect(out.value).toMatchObject({
				anchor: null,
				note: expect.stringContaining("not in that file"),
			});
		}
	});

	it("a hypothesis links recorded evidence by id and is updated by its id; unknown ids are refused", async () => {
		const { entry, found, call } = await live();
		await call("evidence_record", { observation: "o", source: "s", quote: "q quote" });
		const bad = await call("hypothesis_record", {
			statement: "pool",
			status: "supported",
			evidence: ["e2"],
		});
		expect(bad.isError).toBe(true);
		const h = await call("hypothesis_record", {
			statement: "pool",
			status: "speculative",
			evidence: ["e1"],
		});
		expect(h.value).toEqual({ id: "h1", evidence: ["e1"] });
		await call("hypothesis_record", {
			id: "h1",
			statement: "pool exhausted",
			status: "confirmed",
		});
		expect(
			found.flatMap((f) => (f.type === "hypothesis" ? [f.status] : [])),
		).toEqual(["speculative", "confirmed"]);
		expect(entry.findings?.().hypotheses).toEqual([
			expect.objectContaining({
				id: "h1",
				statement: "pool exhausted",
				evidenceIds: ["e1"],
			}),
		]);
	});

	it("nothing is recorded on a run that ended", async () => {
		const { g, call } = await live();
		g.revoke(RUN_A);
		await expect(
			call("evidence_record", { observation: "o", source: "s", quote: "q quote" }),
		).rejects.toThrow("status 401");
	});
});
