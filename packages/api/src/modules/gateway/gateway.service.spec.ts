// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CanonicalEvent,
	type RecordedFinding,
	recordedFindings,
} from "@prismalens/contracts/schemas";
import { resultValue } from "@prismalens/integrations/harness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const ALL_TOOLS = [
	"artifact_publish",
	"attachment_read",
	"attachments_list",
	"changes_list",
	"evidence_record",
	"fixes_list",
	"hypothesis_record",
	"incident_get",
	"incidents_similar",
	"investigations_search",
	"report_validate",
	"run_status",
	"runbooks_list",
	"runbooks_read",
	"service_get",
	"thread_list",
	"thread_read",
	"timeline_read",
];

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
		expect(tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS);
		expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
	});

	it("the lease names the same tools, and the prompt line sends data access to the agent's own tools", async () => {
		const entry = await gateway().lease(RUN_A, NAME);
		expect([...(entry?.tools ?? [])].sort()).toEqual(ALL_TOOLS);
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
		const got = resultValue(
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
		const [hit] = resultValue(text(out));
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

	it("investigations_search names an unlinked service check's match without an incident, and finds it by service (#979)", async () => {
		investigation.findMany.mockResolvedValueOnce([
			{
				id: RUN_B,
				completedAt: new Date("2026-10-27T10:00:00Z"),
				summary: "checkout p99 drifting",
				rootCause: null,
				rootCauseCategory: null,
				incident: null,
			},
		] as never);

		const out = await call("tools/call", { name: "investigations_search", arguments: { query: "p99", service: "checkout" } });

		expect(out.error).toBeUndefined();
		const found = JSON.parse(text(out)) as { investigationId: string; incident: unknown; operatorRecordedCause: unknown }[];
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ investigationId: RUN_B, incident: null, operatorRecordedCause: null });
		const where = JSON.stringify(investigation.findMany.mock.calls.at(-1));
		expect(where).toContain('"service":{"OR":[{"name":"checkout"},{"displayName":"checkout"}]}');
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
		const got = resultValue(text(res));

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
			return { isError: !!r.isError, text, value: resultValue(text) };
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

	it("an output landing after the record anchors it, and the run view hears the update", async () => {
		const { entry, found, call } = await live();
		await call("evidence_record", { observation: "o", source: "s", quote: "late line" });
		entry.sawOutput?.("toolu_9", "a\nlate line\n");
		expect(found.map((f) => f.type === "evidence" && f.anchor)).toEqual([
			null,
			{ in: "tool-output", toolCallId: "toolu_9", line: 2 },
		]);
	});

	it("a follow-up's lease restores what earlier turns recorded", async () => {
		const g = gateway();
		const first = await g.lease(RUN_A, NAME);
		const earlier = {
			evidence: [],
			hypotheses: [
				{ id: "rh1", statement: "pool", status: "speculative" as const, evidenceIds: [], at: "2026-10-28T10:00:00.000Z" },
			],
		};
		await first?.restore?.(async () => earlier);
		g.revoke(RUN_A);
		const next = await g.lease(RUN_A, NAME);
		expect(next?.findings?.()).toEqual({ evidence: [], hypotheses: [] });
		await next?.restore?.(async () => earlier);
		expect(next?.findings?.().hypotheses.map((h) => h.id)).toEqual(["rh1"]);
	});

	it("refuses to record while the run's history could not be read, and records once a retry reads it (OBJ-006)", async () => {
		const { entry, found, call } = await live();
		const e1: RecordedFinding = { type: "evidence", id: "e1", observation: "pool full", source: "logs", quote: "pool exhausted", direction: "supports", anchor: null, at: "2026-10-28T10:00:00.000Z" };
		const stored: CanonicalEvent[] = [
			{ kind: "finding_recorded", runId: RUN_A, branchId: "main", path: [], seq: 1, ts: "2026-10-28T10:00:00.000Z", finding: e1 },
		];
		let readable = false;
		await entry.restore?.(async () => {
			if (!readable) throw new Error("db busy");
			return recordedFindings(stored);
		});
		const refused = await call("evidence_record", { observation: "dns", source: "dig", quote: "SERVFAIL here" });
		expect(refused.isError).toBe(true);
		expect(refused.text).toMatch(/retry/i);
		const hyp = await call("hypothesis_record", { statement: "dns", status: "speculative" });
		expect(hyp.isError).toBe(true);
		expect(found).toEqual([]);
		expect(entry.findings?.()).toEqual({ evidence: [], hypotheses: [] });
		expect(recordedFindings(stored).evidence).toEqual([expect.objectContaining({ id: "e1", observation: "pool full" })]);
		readable = true;
		const ok = await call("evidence_record", { observation: "dns", source: "dig", quote: "SERVFAIL here" });
		expect(ok.value).toMatchObject({ id: "e2" });
		expect(entry.findings?.().evidence.map((e) => e.id)).toEqual(["e1", "e2"]);
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
		expect(h.value).toEqual({ id: "rh1", evidence: ["e1"] });
		await call("hypothesis_record", {
			id: "rh1",
			statement: "pool exhausted",
			status: "confirmed",
		});
		expect(
			found.flatMap((f) => (f.type === "hypothesis" ? [f.status] : [])),
		).toEqual(["speculative", "confirmed"]);
		expect(entry.findings?.().hypotheses).toEqual([
			expect.objectContaining({
				id: "rh1",
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

describe("gateway views, search and the call record (#848)", () => {
	async function leased(g: GatewayService, runId: string, harness?: string) {
		const entry = await g.lease(runId, NAME, harness);
		if (!entry) throw new Error("no lease");
		return entry;
	}
	const send = async (
		g: GatewayService,
		runId: string,
		token: string,
		name: string,
		args: Record<string, unknown>,
	) =>
		body(
			await g.serve(
				runId,
				rpc(runId, "tools/call", { name, arguments: args }, token),
			),
		);
	const textOf = (out: Record<string, unknown>) =>
		resultValue(
			(out.result as { content: { text: string }[] }).content[0]?.text ??
				"null",
		);

	it("onCall carries what replay needs: id, input, the text the agent got, timing and schema", async () => {
		const g = gateway();
		const a = await leased(g, RUN_A);
		const seen: Record<string, unknown>[] = [];
		a.onCall((c) => seen.push({ ...c }));
		await send(g, RUN_A, a.token, "runbooks_list", {});
		expect(seen[0]).toMatchObject({
			name: "runbooks_list",
			input: {},
			isError: false,
			output: expect.any(String),
			ms: expect.any(Number),
		});
		expect(seen[0]?.callId).toEqual(expect.any(String));
		expect(seen[0]?.schemaHash).toMatch(/^[0-9a-f]{16}$/);
	});

	it("a failure reaches the agent as {error, message, next}", async () => {
		const g = gateway({
			...EMPTY,
			incident: { findUnique: async () => null },
		});
		const a = await leased(g, RUN_A);
		const out = await send(g, RUN_A, a.token, "incident_get", { number: 99 });
		expect((out.result as { isError?: boolean }).isError).toBe(true);
		expect(textOf(out)).toEqual({
			error: "not_found",
			message: expect.stringContaining("#99"),
			next: expect.any(String),
		});
	});

	it("an unknown tool is a protocol error, not a tool result", async () => {
		const g = gateway();
		const a = await leased(g, RUN_A);
		const out = await send(g, RUN_A, a.token, "prometheus_query", {});
		expect(out.error).toBeDefined();
		expect(out.result).toBeUndefined();
	});

	it("with search on, deferred tools are not listed and are refused when called directly, but run through tools_call", async () => {
		const findMany = vi.fn(async () => []);
		const g = gateway({
			...EMPTY,
			investigation: { findUnique: async () => null, findMany },
		});
		g.toolSearch = () => true;
		const a = await leased(g, RUN_A, "any");
		const listed = (
			(await body(await g.serve(RUN_A, rpc(RUN_A, "tools/list", {}, a.token))))
				.result as { tools: { name: string }[] }
		).tools.map((t) => t.name);
		expect(listed.sort()).toEqual([
			"artifact_publish",
			"evidence_record",
			"hypothesis_record",
			"incident_get",
			"runbooks_read",
			"tools_call",
			"tools_search",
		]);
		expect(a.promptLine).toContain("tools_search");
		const direct = await send(g, RUN_A, a.token, "investigations_search", {
			query: "checkout",
		});
		expect(direct.error).toBeDefined();
		expect(findMany).not.toHaveBeenCalled();
		const found = textOf(
			await send(g, RUN_A, a.token, "tools_search", {
				query: "past investigations",
			}),
		);
		expect(found.tools[0].name).toBe("investigations_search");
		const seen: string[] = [];
		a.onCall((c) => seen.push(c.name));
		const out = await send(g, RUN_A, a.token, "tools_call", {
			name: "investigations_search",
			arguments: { query: "checkout" },
		});
		expect(textOf(out)).toEqual([]);
		expect(findMany).toHaveBeenCalledTimes(1);
		expect(seen).toEqual(["investigations_search"]);
		const refused = await send(g, RUN_A, a.token, "tools_call", {
			name: "evidence_record",
			arguments: { observation: "o", source: "s", quote: "abcd" },
		});
		expect(textOf(refused).error).toBe("not_found");
		expect(a.findings?.().evidence).toEqual([]);
	});
});

describe("artifact_publish (#871)", () => {
	it("hands a published page to the run's listener only, numbered per run, and stops at the per-run cap", async () => {
		const g = gateway();
		const a = await g.lease(RUN_A, NAME);
		const b = await g.lease(RUN_B, NAME);
		if (!a || !b) throw new Error("no lease");
		const pagesA: { id: string; title: string }[] = [];
		const pagesB: unknown[] = [];
		a.onArtifact?.((p) => pagesA.push(p));
		b.onArtifact?.((p) => pagesB.push(p));
		const publish = async (title: string) =>
			body(
				await g.serve(
					RUN_A,
					rpc(
						RUN_A,
						"tools/call",
						{ name: "artifact_publish", arguments: { title, html: "<p>x</p>" } },
						a.token,
					),
				),
			);
		const first = await publish("Timeline");
		expect(
			resultValue((first.result as { content: { text: string }[] }).content[0]?.text ?? ""),
		).toEqual({ id: "a1", published: true });
		expect(pagesA).toMatchObject([{ id: "a1", title: "Timeline", html: "<p>x</p>" }]);
		expect(pagesB).toEqual([]);
		for (let i = 2; i <= 20; i++) await publish(`p${i}`);
		const over = await publish("one too many");
		expect((over.result as { isError?: boolean }).isError).toBe(true);
		expect(pagesA).toHaveLength(20);
	});
});

describe("read tools for the coding agent (#848)", () => {
	const NOW = new Date("2026-10-25T09:00:00Z");
	const FINISHED = "33333333-3333-4333-8333-333333333333";
	const LIVE = "44444444-4444-4444-8444-444444444444";
	const ON_SERVICE = "55555555-5555-4555-8555-555555555555";
	const UNRELATED = "66666666-6666-4666-8666-666666666666";
	const incident = {
		id: "inc-1",
		number: 12,
		triggeredAt: new Date("2026-10-24T09:00:00Z"),
		serviceId: "svc-1",
	};
	const report = {
		summary: "checkout ran out of connections",
		rootCause: "pool max 50 is below the load",
		rootCauseCategory: "config",
		culprit: { service: "checkout", changeRef: "v2.1.0", mechanism: "pool" },
		hypotheses: [
			{ statement: "the pool is too small", status: "supported", evidence: [] },
			{ statement: "a leak in the cart", status: "refuted", evidence: [] },
		],
		ruledOut: [],
		coverage: { queried: ["logs"], notQueried: [] },
		nextSteps: [{ title: "Raise the pool", detail: "max 50 to 100" }],
	};
	const thread = (id: string, over: Record<string, unknown> = {}) => ({
		id,
		kind: "investigation",
		status: "completed",
		startedAt: new Date("2026-10-20T10:00:00Z"),
		completedAt: new Date("2026-10-20T10:09:00Z"),
		harness: "claude-code",
		model: "opus",
		summary: report.summary,
		rootCause: report.rootCause,
		report: JSON.stringify(report),
		error: null,
		incident: { id: "inc-1", number: 12, serviceId: "svc-1" },
		...over,
	});
	const runRow = (over: Record<string, unknown> = {}) => ({
		...thread(RUN_A, { status: "running", completedAt: null, report: null }),
		startedAt: new Date(NOW.getTime() - 60_000),
		accessLevel: "supervised",
		usage: JSON.stringify({
			used: 12_000,
			size: 200_000,
			cost: { amount: 0.42, currency: "USD" },
			at: "2026-10-25T08:59:00Z",
		}),
		workspace: JSON.stringify({
			layout: "multi",
			cwd: "/w",
			repos: [
				{
					name: "checkout-api",
					dir: "/w/checkout-api",
					sourceKind: "url",
					url: "https://example.test/checkout-api",
					subPath: "svc",
					connectionId: null,
					head: "abc1234def5678",
					branch: "main",
					services: ["checkout"],
				},
			],
		}),
		incident,
		...over,
	});
	const rows: Record<string, unknown> = {
		[FINISHED]: thread(FINISHED),
		[LIVE]: thread(LIVE, {
			status: "running",
			completedAt: null,
			report: null,
			summary: null,
			rootCause: null,
		}),
		[ON_SERVICE]: thread(ON_SERVICE, {
			incident: { id: "inc-7", number: 7, serviceId: "svc-2" },
		}),
		[UNRELATED]: thread(UNRELATED, {
			incident: { id: "inc-9", number: 9, serviceId: "svc-9" },
		}),
	};
	const known = [
		{ id: "svc-1", name: "checkout" },
		{ id: "svc-2", name: "payments" },
	];
	const checkout = {
		...known[0],
		displayName: "Checkout",
		type: "service",
		tier: "tier_1",
		team: "commerce",
		slackChannel: "#checkout-oncall",
		tags: JSON.stringify(["web", "revenue"]),
		repositories: [
			{
				subPath: "svc",
				repository: { fullName: "acme/checkout-api", defaultBranch: "main" },
			},
		],
		dependencies: [{ criticality: "required", dependency: { name: "payments" } }],
		dependents: [{ criticality: "degraded", dependent: { name: "storefront" } }],
	};

	type AttachmentRow = {
		id: string;
		incidentId: string;
		name: string;
		mimeType: string;
		size: number;
		createdAt: Date;
	};
	const attachmentRows: AttachmentRow[] = [
		{
			id: "att-1",
			incidentId: "inc-1",
			name: "app.log",
			mimeType: "text/plain",
			size: 20,
			createdAt: new Date("2026-10-24T09:40:00Z"),
		},
		{
			id: "att-2",
			incidentId: "inc-1",
			name: "graph.png",
			mimeType: "image/png",
			size: 4_000,
			createdAt: new Date("2026-10-24T09:10:00Z"),
		},
		{
			id: "att-big",
			incidentId: "inc-1",
			name: "big.log",
			mimeType: "text/plain",
			size: 32_004,
			createdAt: new Date("2026-10-24T09:00:00Z"),
		},
		{
			id: "att-other",
			incidentId: "inc-9",
			name: "other.log",
			mimeType: "text/plain",
			size: 14,
			createdAt: new Date("2026-10-24T09:00:00Z"),
		},
	];
	const recommendationRow = (id: string, over: Record<string, unknown>) => ({
		id,
		investigationId: FINISHED,
		title: "Raise the pool",
		description: null,
		priority: "medium",
		category: null,
		status: "pending",
		implementedAt: null,
		investigation: { incident: { id: "inc-7", number: 7 } },
		...over,
	});
	const fixCheck = (verdict: string, at: string) => ({
		metadata: JSON.stringify({
			investigationId: FINISHED,
			stepId: "rec-1",
			event: "fix_check",
			verdict,
			checkedAt: at,
		}),
		occurredAt: new Date(at),
	});

	function mocks(over: { run?: unknown } = {}) {
		return {
			attachment: {
				findMany: vi.fn(async () =>
					attachmentRows.filter((a) => a.incidentId === "inc-1"),
				),
				findFirst: vi.fn(
					async ({ where }: { where: { id: string; incidentId: string } }) =>
						attachmentRows.find(
							(a) => a.id === where.id && a.incidentId === where.incidentId,
						) ?? null,
				),
			},
			incidentSimilarity: {
				findMany: vi.fn(async () => [
					{
						similarIncidentId: "inc-7",
						similarityScore: 72,
						matchFactors: JSON.stringify({
							matchedOn: ["same service", "alert labels"],
						}),
					},
					{
						similarIncidentId: "inc-3",
						similarityScore: 41,
						matchFactors: null,
					},
				]),
			},
			incident: {
				findMany: vi.fn(async () => [
					{
						id: "inc-3",
						number: 3,
						title: "checkout 5xx",
						status: "investigating",
						resolvedAt: null,
						actualCause: null,
						actualCauseCategory: null,
						service: null,
					},
					{
						id: "inc-7",
						number: 7,
						title: "payments timeouts",
						status: "resolved",
						resolvedAt: new Date("2026-09-01T10:00:00Z"),
						actualCause: "pool max too low",
						actualCauseCategory: "config",
						service: { name: "payments" },
					},
				]),
			},
			recommendation: {
				findMany: vi.fn(async () => [
					recommendationRow("rec-1", {
						description: "max 50 to 100",
						priority: "high",
						category: "config_change",
						status: "completed",
						implementedAt: new Date("2026-10-20T11:00:00Z"),
					}),
					recommendationRow("rec-2", {
						title: "Roll back v2.1.0",
						status: "rejected",
					}),
				]),
			},
			investigation: {
				findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
					where.id === RUN_A
						? "run" in over
							? over.run
							: runRow()
						: (rows[where.id] ?? null),
				),
				findMany: vi.fn(async () => [rows[FINISHED], rows[LIVE]]),
			},
			investigationEvent: {
				findMany: vi.fn(async () => [
					{ event: JSON.stringify({ kind: "tool_result", text: "ignored" }) },
					...Array.from({ length: 30 }, (_, i) => ({
						event: JSON.stringify({
							kind: "agent_step",
							text: `step ${30 - i}`,
							toolCalls: [],
						}),
					})),
				]),
			},
			alert: {
				findMany: vi.fn(async () => [
					{ serviceId: "svc-1" },
					{ serviceId: "svc-2" },
				]),
			},
			service: {
				findUnique: vi.fn(async ({ where }: { where: { name: string } }) =>
					where.name === "checkout"
						? checkout
						: where.name === "payments"
							? { ...known[1], tier: "tier_2" }
							: null,
				),
				findMany: vi.fn(
					async ({
						where,
					}: {
						where: { id?: { in: string[] }; name?: { in: string[] } };
					}) =>
						known.filter((s) =>
							where.name
								? where.name.in.includes(s.name)
								: where.id?.in.includes(s.id),
						),
				),
			},
			timelineEntry: {
				count: vi.fn(async () => 3),
				findMany: vi.fn(async ({ where }: { where: { metadata?: unknown } }) =>
					where.metadata
						? [
								fixCheck("it_worked", "2026-10-20T12:00:00Z"),
								fixCheck("not_yet", "2026-10-20T10:00:00Z"),
							]
						: [
					{
						type: "status_changed",
						title: "Status changed to identified",
						description: null,
						source: "user",
						occurredAt: new Date("2026-10-24T09:30:00Z"),
					},
					{
						type: "investigation_completed",
						title: "Investigation finished",
						description: "pool exhausted",
						source: "ai_worker",
						occurredAt: new Date("2026-10-24T09:20:00Z"),
					},
					{
						type: "incident_created",
						title: "Incident created",
						description: null,
						source: "system",
						occurredAt: new Date("2026-10-24T09:00:00Z"),
					},
				]),
			},
			changeEvent: {
				findMany: vi.fn(async () => [
					{
						type: "deploy",
						source: "argocd",
						timestamp: new Date("2026-10-24T08:30:00Z"),
						description: "deployed checkout v2.1.0",
						metadata: JSON.stringify({
							environment: "production",
							version: "v2.1.0",
						}),
						service: { name: "checkout" },
					},
				]),
			},
			setting: { findUnique: async () => null },
		};
	}

	type Result = {
		isError: boolean;
		value: Record<string, unknown> & {
			problems?: { field: string; expected: string }[];
			threads?: Record<string, unknown>[];
			entries?: Record<string, unknown>[];
			changes?: Record<string, unknown>[];
		};
	};
	async function use(
		m: ReturnType<typeof mocks>,
		name: string,
		args: Record<string, unknown> = {},
	): Promise<Result> {
		const g = gateway(m);
		const a = await g.lease(RUN_A, NAME);
		const res = await g.serve(
			RUN_A,
			rpc(RUN_A, "tools/call", { name, arguments: args }, a?.token),
		);
		const r = (await body(res)).result as {
			content: { text: string }[];
			isError?: boolean;
		};
		return {
			isError: !!r.isError,
			value: resultValue(r.content[0]?.text ?? "{}"),
		};
	}
	const failure = (code: string) => ({
		error: code,
		message: expect.any(String),
		next: expect.any(String),
	});

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	describe("thread_list", () => {
		it("lists the incident's other threads, newest first, with what a thread needs to be picked", async () => {
			const m = mocks();
			const out = await use(m, "thread_list");
			expect(out.isError).toBe(false);
			expect(out.value.threads).toEqual([
				{
					id: FINISHED,
					kind: "investigation",
					status: "completed",
					startedAt: "2026-10-20T10:00:00.000Z",
					finishedAt: "2026-10-20T10:09:00.000Z",
					agent: "claude-code",
					model: "opus",
					summary: report.summary,
				},
				{
					id: LIVE,
					kind: "investigation",
					status: "running",
					startedAt: "2026-10-20T10:00:00.000Z",
					finishedAt: null,
					agent: "claude-code",
					model: "opus",
				},
			]);
			expect(m.investigation.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: { not: RUN_A }, incidentId: "inc-1" },
					orderBy: { createdAt: "desc" },
					take: 10,
				}),
			);
		});

		it("lists a named service's threads across its incidents", async () => {
			const m = mocks();
			await use(m, "thread_list", { service: "payments", limit: 3 });
			expect(m.investigation.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: { not: RUN_A }, incident: { serviceId: "svc-2" } },
					take: 3,
				}),
			);
		});

		it("an unknown service is not_found", async () => {
			const out = await use(mocks(), "thread_list", { service: "nope" });
			expect(out.isError).toBe(true);
			expect(out.value).toEqual(failure("not_found"));
		});

		it("with no incident and no service is not_found", async () => {
			const out = await use(mocks({ run: { incident: null } }), "thread_list");
			expect(out.value).toEqual(failure("not_found"));
		});

		it("refuses a limit over 50", async () => {
			const out = await use(mocks(), "thread_list", { limit: 51 });
			expect(out.value).toEqual(failure("invalid_input"));
		});
	});

	describe("thread_read", () => {
		it("returns a finished thread's report", async () => {
			const out = await use(mocks(), "thread_read", { threadId: FINISHED });
			expect(out.isError).toBe(false);
			expect(out.value).toEqual({
				id: FINISHED,
				kind: "investigation",
				status: "completed",
				summary: report.summary,
				rootCause: report.rootCause,
				hypotheses: [
					{ statement: "the pool is too small", status: "supported" },
					{ statement: "a leak in the cart", status: "refuted" },
				],
				nextSteps: [{ title: "Raise the pool", detail: "max 50 to 100" }],
				culprit: { service: "checkout", changeRef: "v2.1.0", mechanism: "pool" },
			});
		});

		it("gives a running thread's status only: another run's unfinished reasoning is never read", async () => {
			const m = mocks();
			const out = await use(m, "thread_read", { threadId: LIVE });
			expect(out.value).toMatchObject({ id: LIVE, status: "running", steps: [] });
			expect(out.value).not.toHaveProperty("hypotheses");
			expect(m.investigationEvent.findMany).not.toHaveBeenCalled();
		});

		it("reads a thread on another incident of a service of this run's incident", async () => {
			const out = await use(mocks(), "thread_read", { threadId: ON_SERVICE });
			expect(out.isError).toBe(false);
			expect(out.value.id).toBe(ON_SERVICE);
		});

		it("refuses a thread on an unrelated incident, and reads nothing of it", async () => {
			const m = mocks();
			const out = await use(m, "thread_read", { threadId: UNRELATED });
			expect(out.isError).toBe(true);
			expect(out.value).toEqual(failure("not_found"));
			expect(m.investigationEvent.findMany).not.toHaveBeenCalled();
		});

		it("an id nobody has is not_found", async () => {
			const out = await use(mocks(), "thread_read", { threadId: "missing" });
			expect(out.value).toEqual(failure("not_found"));
		});

		it("an empty id is invalid_input", async () => {
			const out = await use(mocks(), "thread_read", { threadId: "" });
			expect(out.value).toEqual(failure("invalid_input"));
		});
	});

	describe("timeline_read", () => {
		it("returns the incident's timeline oldest first with who wrote each line", async () => {
			const m = mocks();
			const out = await use(m, "timeline_read");
			expect(out.isError).toBe(false);
			expect(out.value).toEqual({
				incident: 12,
				total: 3,
				entries: [
					{
						type: "incident_created",
						source: "system",
						text: "Incident created",
						at: "2026-10-24T09:00:00.000Z",
					},
					{
						type: "investigation_completed",
						source: "agent",
						text: "Investigation finished: pool exhausted",
						at: "2026-10-24T09:20:00.000Z",
					},
					{
						type: "status_changed",
						source: "operator",
						text: "Status changed to identified",
						at: "2026-10-24T09:30:00.000Z",
					},
				],
			});
			expect(m.timelineEntry.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { incidentId: "inc-1" },
					orderBy: { occurredAt: "desc" },
					take: 10,
				}),
			);
		});

		it("takes the limit", async () => {
			const m = mocks();
			await use(m, "timeline_read", { limit: 5 });
			expect(m.timelineEntry.findMany).toHaveBeenCalledWith(
				expect.objectContaining({ take: 5 }),
			);
		});

		it("a run with no incident is not_found", async () => {
			const out = await use(mocks({ run: { incident: null } }), "timeline_read");
			expect(out.value).toEqual(failure("not_found"));
		});

		it("refuses a limit of 0 or over 50", async () => {
			for (const limit of [0, 51])
				expect((await use(mocks(), "timeline_read", { limit })).value).toEqual(
					failure("invalid_input"),
				);
		});
	});

	describe("service_get", () => {
		it("returns the service's facts with dependencies both ways", async () => {
			const out = await use(mocks(), "service_get", { name: "checkout" });
			expect(out.isError).toBe(false);
			expect(out.value).toEqual({
				name: "checkout",
				displayName: "Checkout",
				type: "service",
				tier: "tier_1",
				team: "commerce",
				slackChannel: "#checkout-oncall",
				tags: ["web", "revenue"],
				repos: [{ name: "acme/checkout-api", subPath: "svc", branch: "main" }],
				dependsOn: [{ name: "payments", criticality: "required" }],
				dependedOnBy: [{ name: "storefront", criticality: "degraded" }],
			});
		});

		it("an unknown service is not_found and points to incident_get", async () => {
			const out = await use(mocks(), "service_get", { name: "nope" });
			expect(out.isError).toBe(true);
			expect(out.value).toEqual(failure("not_found"));
			expect(out.value.next).toContain("incident_get");
			expect(JSON.stringify(out.value)).not.toContain("payments");
		});

		it("an empty name is invalid_input", async () => {
			const out = await use(mocks(), "service_get", { name: " " });
			expect(out.value).toEqual(failure("invalid_input"));
		});
	});

	describe("changes_list", () => {
		it("defaults to the incident's services, from a day before it started until now", async () => {
			const m = mocks();
			const out = await use(m, "changes_list");
			expect(out.isError).toBe(false);
			expect(out.value).toEqual({
				window: {
					from: "2026-10-23T09:00:00.000Z",
					to: "2026-10-25T09:00:00.000Z",
				},
				services: ["checkout", "payments"],
				changes: [
					{
						type: "deploy",
						source: "argocd",
						at: "2026-10-24T08:30:00.000Z",
						service: "checkout",
						description: "deployed checkout v2.1.0",
						environment: "production",
						version: "v2.1.0",
					},
				],
			});
			expect(m.changeEvent.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: {
						serviceId: { in: ["svc-1", "svc-2"] },
						timestamp: {
							gte: new Date("2026-10-23T09:00:00Z"),
							lte: NOW,
						},
					},
					orderBy: { timestamp: "desc" },
					take: 10,
				}),
			);
		});

		it("takes named services and an explicit window", async () => {
			const m = mocks();
			await use(m, "changes_list", {
				services: ["payments"],
				from: "2026-10-22T00:00:00Z",
				to: "2026-10-23T00:00:00Z",
				limit: 4,
			});
			expect(m.changeEvent.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: {
						serviceId: { in: ["svc-2"] },
						timestamp: {
							gte: new Date("2026-10-22T00:00:00Z"),
							lte: new Date("2026-10-23T00:00:00Z"),
						},
					},
					take: 4,
				}),
			);
		});

		it("a lone old `from` ends seven days later, not now", async () => {
			const out = await use(mocks(), "changes_list", {
				from: "2026-10-10T00:00:00Z",
			});
			expect(out.value.window).toEqual({
				from: "2026-10-10T00:00:00.000Z",
				to: "2026-10-17T00:00:00.000Z",
			});
		});

		it("works without an incident when services are named", async () => {
			const out = await use(mocks({ run: { incident: null } }), "changes_list", {
				services: ["checkout"],
			});
			expect(out.isError).toBe(false);
			expect(out.value.window).toEqual({
				from: "2026-10-24T09:00:00.000Z",
				to: "2026-10-25T09:00:00.000Z",
			});
		});

		it("with no incident and no services is not_found", async () => {
			const out = await use(mocks({ run: { incident: null } }), "changes_list");
			expect(out.value).toEqual(failure("not_found"));
		});

		it("an unknown service is not_found and names it", async () => {
			const out = await use(mocks(), "changes_list", {
				services: ["checkout", "nope"],
			});
			expect(out.value).toEqual(failure("not_found"));
			expect(out.value.message).toContain("nope");
		});

		it("a window over seven days is invalid_input", async () => {
			const out = await use(mocks(), "changes_list", {
				from: "2026-10-01T00:00:00Z",
				to: "2026-10-09T00:00:00Z",
			});
			expect(out.value).toEqual(failure("invalid_input"));
		});

		it("a window that ends before it starts is invalid_input", async () => {
			const out = await use(mocks(), "changes_list", {
				from: "2026-10-24T00:00:00Z",
				to: "2026-10-23T00:00:00Z",
			});
			expect(out.value).toEqual(failure("invalid_input"));
		});

		it("a time that is not ISO is invalid_input", async () => {
			const out = await use(mocks(), "changes_list", { from: "yesterday" });
			expect(out.value).toEqual(failure("invalid_input"));
		});
	});

	describe("run_status", () => {
		it("reports usage, time left, access level and the workspace repos at their commits", async () => {
			const out = await use(mocks(), "run_status");
			expect(out.isError).toBe(false);
			expect(out.value).toEqual({
				status: "running",
				usage: {
					used: 12_000,
					size: 200_000,
					cost: { amount: 0.42, currency: "USD" },
				},
				secondsLeft: 840,
				accessLevel: "supervised",
				repos: [
					{
						name: "checkout-api",
						subPath: "svc",
						branch: "main",
						commit: "abc1234def5678",
						services: ["checkout"],
					},
				],
			});
		});

		it("says null for what the run never recorded, never zero", async () => {
			const out = await use(
				mocks({
					run: runRow({
						usage: null,
						startedAt: null,
						workspace: null,
						accessLevel: null,
					}),
				}),
				"run_status",
			);
			expect(out.value).toEqual({
				status: "running",
				usage: null,
				secondsLeft: null,
				accessLevel: null,
				repos: [],
			});
		});

		it("a run that is gone is not_found", async () => {
			const out = await use(mocks({ run: null }), "run_status");
			expect(out.value).toEqual(failure("not_found"));
		});
	});

	describe("report_validate", () => {
		const valid = JSON.stringify({
			summary: "checkout ran out of connections",
			rootCause: null,
			rootCauseCategory: null,
			hypotheses: [],
			ruledOut: [],
			coverage: { queried: ["logs"], notQueried: [] },
			nextSteps: [],
		});
		const fenced = (json: string) => `Done.\n\n\`\`\`json\n${json}\n\`\`\`\n`;

		it("says valid for a final answer that carries a valid report", async () => {
			const out = await use(mocks(), "report_validate", {
				report: fenced(valid),
			});
			expect(out.isError).toBe(false);
			expect(out.value).toEqual({ valid: true });
		});

		it("names each field that fails and what it expects", async () => {
			const bad = JSON.stringify({ ...JSON.parse(valid), summary: 7 });
			const out = await use(mocks(), "report_validate", {
				report: fenced(bad),
			});
			expect(out.isError).toBe(false);
			expect(out.value.valid).toBe(false);
			expect(out.value.problems).toEqual([
				{ field: "summary", expected: expect.stringContaining("string") },
			]);
			expect(out.value.next).toEqual(expect.any(String));
		});

		it("lists a missing field by its path", async () => {
			const { coverage: _c, ...rest } = JSON.parse(valid);
			const out = await use(mocks(), "report_validate", {
				report: fenced(JSON.stringify(rest)),
			});
			expect(out.value.valid).toBe(false);
			expect(out.value.problems?.map((p) => p.field)).toEqual(["coverage"]);
		});

		it("an answer with no json block has one problem about the block", async () => {
			const out = await use(mocks(), "report_validate", {
				report: "All done.",
			});
			expect(out.value.valid).toBe(false);
			expect(out.value.problems).toEqual([
				{ field: "report", expected: expect.stringContaining("```json") },
			]);
		});

		it("a block that is not JSON is a problem about the block", async () => {
			const out = await use(mocks(), "report_validate", {
				report: fenced("{ not json"),
			});
			expect(out.value.valid).toBe(false);
			expect(out.value.problems?.[0]?.field).toBe("report");
		});

		it("an empty answer is invalid_input", async () => {
			const out = await use(mocks(), "report_validate", { report: "" });
			expect(out.isError).toBe(true);
			expect(out.value).toEqual(failure("invalid_input"));
		});
	});

	describe("attachments_list", () => {
		it("lists the incident's attached files, newest first", async () => {
			const m = mocks();
			const out = await use(m, "attachments_list");
			expect(out.isError).toBe(false);
			expect(out.value).toEqual({
				incident: 12,
				attachments: [
					{
						id: "att-1",
						name: "app.log",
						mimeType: "text/plain",
						size: 20,
						at: "2026-10-24T09:40:00.000Z",
					},
					{
						id: "att-2",
						name: "graph.png",
						mimeType: "image/png",
						size: 4_000,
						at: "2026-10-24T09:10:00.000Z",
					},
					{
						id: "att-big",
						name: "big.log",
						mimeType: "text/plain",
						size: 32_004,
						at: "2026-10-24T09:00:00.000Z",
					},
				],
			});
			expect(m.attachment.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { incidentId: "inc-1" },
					orderBy: { createdAt: "desc" },
				}),
			);
		});

		it("an incident with none gives an empty list", async () => {
			const m = mocks();
			m.attachment.findMany.mockResolvedValueOnce([]);
			const out = await use(m, "attachments_list");
			expect(out.value).toEqual({ incident: 12, attachments: [] });
		});

		it("a run with no incident is not_found", async () => {
			const out = await use(
				mocks({ run: { incident: null } }),
				"attachments_list",
			);
			expect(out.value).toEqual(failure("not_found"));
		});
	});

	describe("attachment_read", () => {
		let dir: string;
		beforeEach(() => {
			dir = mkdtempSync(join(tmpdir(), "pl-att-"));
			mkdirSync(join(dir, "attachments"));
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", dir);
			writeFileSync(join(dir, "attachments", "att-1"), "ERROR pool exhausted\n");
			writeFileSync(
				join(dir, "attachments", "att-big"),
				`${"x".repeat(32_000)}TAIL`,
			);
			writeFileSync(join(dir, "attachments", "att-2"), "not text");
			writeFileSync(join(dir, "attachments", "att-other"), "someone else's");
		});
		afterEach(() => {
			vi.unstubAllEnvs();
			rmSync(dir, { recursive: true, force: true });
		});

		it("returns the text of an attachment on the run's incident", async () => {
			const m = mocks();
			const out = await use(m, "attachment_read", { id: "att-1" });
			expect(out.isError).toBe(false);
			expect(out.value).toEqual({
				id: "att-1",
				name: "app.log",
				mimeType: "text/plain",
				size: 20,
				text: "ERROR pool exhausted\n",
				truncated: false,
			});
			expect(m.attachment.findFirst).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: "att-1", incidentId: "inc-1" },
				}),
			);
		});

		it("an attachment of another incident is not_found, and its file is not read", async () => {
			const out = await use(mocks(), "attachment_read", { id: "att-other" });
			expect(out.isError).toBe(true);
			expect(out.value).toEqual(failure("not_found"));
			expect(JSON.stringify(out.value)).not.toContain("someone else's");
		});

		it("an id nobody has is not_found", async () => {
			const out = await use(mocks(), "attachment_read", { id: "missing" });
			expect(out.value).toEqual(failure("not_found"));
		});

		it("a file that is not text is invalid_input and next says so", async () => {
			const out = await use(mocks(), "attachment_read", { id: "att-2" });
			expect(out.isError).toBe(true);
			expect(out.value).toEqual({
				...failure("invalid_input"),
				message: expect.stringContaining("image/png"),
				next: expect.stringContaining("not text"),
			});
		});

		it("cuts a long file and says so, keeping the whole result valid JSON", async () => {
			const out = await use(mocks(), "attachment_read", { id: "att-big" });
			expect(out.isError).toBe(false);
			const shown = (out.value.text as string).length;
			expect(shown).toBeLessThanOrEqual(32_000);
			expect(shown).toBeGreaterThan(31_000);
			expect(out.value.text).not.toContain("TAIL");
			expect(out.value.truncated).toBe(true);
			expect(out.value.note).toBe(`Cut at ${shown} of 32004 characters.`);
		});

		it("cuts sooner when escaping makes the result longer than the text", async () => {
			writeFileSync(join(dir, "attachments", "att-1"), "line\n".repeat(10_000));
			const out = await use(mocks(), "attachment_read", { id: "att-1" });
			expect(out.value.truncated).toBe(true);
			expect((out.value.text as string).length).toBeLessThan(32_000);
			expect(out.value.note).toEqual(expect.stringContaining("of 50000"));
		});

		it("a row whose file is gone is not_found", async () => {
			rmSync(join(dir, "attachments", "att-1"));
			const out = await use(mocks(), "attachment_read", { id: "att-1" });
			expect(out.value).toEqual(failure("not_found"));
		});

		it("takes JSON, YAML, XML and CSV as text", async () => {
			for (const mimeType of [
				"application/json",
				"application/x-yaml",
				"application/xml",
				"text/csv",
				"application/vnd.api+json",
			]) {
				const m = mocks();
				m.attachment.findFirst.mockResolvedValueOnce({
					id: "att-1",
					incidentId: "inc-1",
					name: "f",
					mimeType,
					size: 20,
					createdAt: new Date(),
				});
				const out = await use(m, "attachment_read", { id: "att-1" });
				expect(out.isError, mimeType).toBe(false);
			}
		});

		it("an empty id is invalid_input", async () => {
			const out = await use(mocks(), "attachment_read", { id: "" });
			expect(out.value).toEqual(failure("invalid_input"));
		});
	});

	describe("incidents_similar", () => {
		it("lists the past incidents the table holds for this one, best first, with the recorded cause", async () => {
			const m = mocks();
			const out = await use(m, "incidents_similar");
			expect(out.isError).toBe(false);
			expect(out.value).toEqual({
				incident: 12,
				similar: [
					{
						number: 7,
						title: "payments timeouts",
						service: "payments",
						status: "resolved",
						resolvedAt: "2026-09-01T10:00:00.000Z",
						actualCause: { cause: "pool max too low", category: "config" },
						similarityScore: 72,
						matchedOn: ["same service", "alert labels"],
					},
					{
						number: 3,
						title: "checkout 5xx",
						service: null,
						status: "investigating",
						resolvedAt: null,
						actualCause: null,
						similarityScore: 41,
						matchedOn: [],
					},
				],
			});
			expect(m.incidentSimilarity.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { incidentId: "inc-1" },
					orderBy: [{ similarityScore: "desc" }, { calculatedAt: "desc" }],
					take: 5,
				}),
			);
		});

		it("takes the limit and refuses one over 20", async () => {
			const m = mocks();
			await use(m, "incidents_similar", { limit: 20 });
			expect(m.incidentSimilarity.findMany).toHaveBeenCalledWith(
				expect.objectContaining({ take: 20 }),
			);
			const out = await use(mocks(), "incidents_similar", { limit: 21 });
			expect(out.value).toEqual(failure("invalid_input"));
		});

		it("an incident with no similarity rows gives an empty list", async () => {
			const m = mocks();
			m.incidentSimilarity.findMany.mockResolvedValueOnce([]);
			const out = await use(m, "incidents_similar");
			expect(out.value).toEqual({ incident: 12, similar: [] });
		});

		it("a run with no incident is not_found", async () => {
			const out = await use(
				mocks({ run: { incident: null } }),
				"incidents_similar",
			);
			expect(out.value).toEqual(failure("not_found"));
		});
	});

	describe("fixes_list", () => {
		it("lists fixes proposed on past investigations of the incident's services, with status and the latest check since it was applied", async () => {
			const m = mocks();
			const out = await use(m, "fixes_list");
			expect(out.isError).toBe(false);
			expect(out.value).toEqual({
				incident: 12,
				fixes: [
					{
						id: "rec-1",
						title: "Raise the pool",
						detail: "max 50 to 100",
						incident: 7,
						investigationId: FINISHED,
						status: "applied",
						priority: "high",
						category: "config_change",
						appliedAt: "2026-10-20T11:00:00.000Z",
						lastCheck: {
							verdict: "it_worked",
							at: "2026-10-20T12:00:00.000Z",
						},
					},
					{
						id: "rec-2",
						title: "Roll back v2.1.0",
						detail: null,
						incident: 7,
						investigationId: FINISHED,
						status: "rejected",
						priority: "medium",
						category: null,
						appliedAt: null,
						lastCheck: null,
					},
				],
			});
			expect(m.recommendation.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: {
						investigation: {
							id: { not: RUN_A },
							incident: { serviceId: { in: ["svc-1", "svc-2"] } },
						},
					},
					orderBy: { createdAt: "desc" },
					take: 10,
				}),
			);
		});

		it("takes the limit and refuses one over 50", async () => {
			const m = mocks();
			await use(m, "fixes_list", { limit: 50 });
			expect(m.recommendation.findMany).toHaveBeenCalledWith(
				expect.objectContaining({ take: 50 }),
			);
			const out = await use(mocks(), "fixes_list", { limit: 51 });
			expect(out.value).toEqual(failure("invalid_input"));
		});

		it("reads no checks when there are no fixes", async () => {
			const m = mocks();
			m.recommendation.findMany.mockResolvedValueOnce([]);
			const out = await use(m, "fixes_list");
			expect(out.value).toEqual({ incident: 12, fixes: [] });
			expect(m.timelineEntry.findMany).not.toHaveBeenCalled();
		});

		it("a run with no incident is not_found", async () => {
			const out = await use(mocks({ run: { incident: null } }), "fixes_list");
			expect(out.value).toEqual(failure("not_found"));
		});
	});

	describe("every tool", () => {
		const LANE_TOOLS = [
			"thread_list",
			"thread_read",
			"timeline_read",
			"service_get",
			"changes_list",
			"run_status",
			"report_validate",
			"attachments_list",
			"attachment_read",
			"incidents_similar",
			"fixes_list",
		];

		it("is read-only and takes no run id", async () => {
			const g = gateway(mocks());
			const a = await g.lease(RUN_A, NAME);
			const res = await body(
				await g.serve(RUN_A, rpc(RUN_A, "tools/list", {}, a?.token)),
			);
			const tools = (
				res.result as {
					tools: {
						name: string;
						inputSchema: { properties?: Record<string, unknown> };
						annotations?: { readOnlyHint?: boolean };
					}[];
				}
			).tools;
			for (const name of LANE_TOOLS) {
				const tool = tools.find((t) => t.name === name);
				expect(tool, name).toBeDefined();
				expect(Object.keys(tool?.inputSchema.properties ?? {})).not.toContain(
					"runId",
				);
				expect(tool?.annotations?.readOnlyHint).toBe(true);
			}
		});

		it("is deferred under tool search, found by name and run through tools_call", async () => {
			const g = gateway(mocks());
			g.toolSearch = () => true;
			const a = await g.lease(RUN_A, NAME, "any");
			const send = async (name: string, args: Record<string, unknown>) =>
				body(
					await g.serve(
						RUN_A,
						rpc(RUN_A, "tools/call", { name, arguments: args }, a?.token),
					),
				);
			const text = (out: Record<string, unknown>) =>
				resultValue(
					(out.result as { content: { text: string }[] }).content[0]?.text ??
						"null",
				);
			const listed = (
				(
					await body(
						await g.serve(RUN_A, rpc(RUN_A, "tools/list", {}, a?.token)),
					)
				).result as { tools: { name: string }[] }
			).tools.map((t) => t.name);
			for (const name of LANE_TOOLS) {
				expect(listed).not.toContain(name);
				expect(
					text(await send("tools_search", { query: name })).tools[0].name,
				).toBe(name);
			}
			expect((await send("run_status", {})).error).toBeDefined();
			const via = text(
				await send("tools_call", { name: "run_status", arguments: {} }),
			);
			expect(via.status).toBe("running");
		});
	});
});
