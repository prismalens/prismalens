// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import type { OpenedSource } from "../integrations/open-source.js";
import { type MonitoringSources, monitoringProviders } from "./monitoring.provider.js";
import { ReferencesService } from "./references.service.js";

const RUN = "6a3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** What each fake source answers, by path; a function throws to play an unreachable host. */
type Routes = Record<string, unknown | (() => never)>;

function opened(id: string, label: string, routes: Routes | string): OpenedSource {
	if (typeof routes === "string") return { id, label, kind: "x", secrets: [], unusable: routes };
	return {
		id,
		label,
		kind: "x",
		secrets: [],
		request: vi.fn(async (_m: string, path: string) => {
			const route = routes[path.split("?")[0] as string];
			if (typeof route === "function") (route as () => never)();
			if (route === undefined) return new Response("no", { status: 404 });
			return new Response(JSON.stringify(route), { status: 200 });
		}) as unknown as OpenedSource["request"],
	};
}

function sources(
	byTemplate: Record<string, { id: string; label: string; routes: Routes | string }[]>,
): MonitoringSources {
	return {
		connections: async (t) => (byTemplate[t] ?? []).map(({ id, label }) => ({ id, label })),
		open: async (src) => {
			const c = Object.values(byTemplate)
				.flat()
				.find((x) => x.id === src.id);
			return opened(src.id, src.label, c?.routes ?? "gone");
		},
	};
}

const AM_ROUTES: Routes = {
	"api/v2/alerts": [
		{
			fingerprint: "f1",
			labels: { alertname: "BooksSlow", severity: "critical" },
			annotations: { summary: "p99 above 2s" },
			startsAt: "2026-11-06T10:00:00Z",
			status: { state: "active" },
		},
	],
	"api/v2/silences": [
		{
			id: "s1",
			comment: "Deploy window",
			createdBy: "ops",
			endsAt: "2026-11-06T12:00:00Z",
			status: { state: "active" },
			matchers: [{ name: "service", value: "books", isRegex: false, isEqual: true }],
		},
		{ id: "s0", status: { state: "expired" }, matchers: [] },
	],
};

const PROM_ROUTES: Routes = {
	"api/v1/rules": {
		data: {
			groups: [
				{
					name: "books",
					rules: [{ name: "BooksSlow", state: "firing", query: "p99 > 2", labels: { severity: "critical" } }],
				},
			],
		},
	},
	"api/v1/alerts": {
		data: { alerts: [{ labels: { alertname: "BooksSlow" }, state: "firing", activeAt: "2026-11-06T10:00:00Z", value: "2.4" }] },
	},
};

const ctx = (kinds: string[]) => ({ root: null, kinds: kinds as never, limit: 20 });

describe("Alertmanager and Prometheus under @ (#1024 spec B)", () => {
	it("Given a firing alert and a silence, Then each is a hit in its connection's group and its snapshot reads it again", async () => {
		const [am] = monitoringProviders(
			sources({ alertmanager: [{ id: "c1", label: "prod", routes: AM_ROUTES }] }),
		);
		if (!am) throw new Error("no provider");
		const hits = await am.search("", ctx(["alert", "silence"]));
		expect(hits).toEqual([
			{ ref: { kind: "alert", id: "c1:f1", label: "BooksSlow" }, detail: "active · critical", group: "Alertmanager" },
			{ ref: { kind: "silence", id: "c1:s1", label: "Deploy window" }, detail: "active until 2026-11-06T12:00:00Z", group: "Alertmanager" },
		]);
		expect(await am.search("deploy", ctx(["alert", "silence"]))).toHaveLength(1);
		const snap = await am.snapshot({ kind: "silence", id: "c1:s1", label: "Deploy window" });
		expect(snap?.text).toContain('service="books"');
		expect(snap?.outOfScope).toBe(true);
		expect(await am.snapshot({ kind: "alert", id: "c9:f1", label: "x" })).toBeNull();
	});

	it("Given Prometheus, Then its alerting rules and firing alerts are hits", async () => {
		const [, prom] = monitoringProviders(
			sources({ prometheus: [{ id: "p1", label: "metrics", routes: PROM_ROUTES }] }),
		);
		if (!prom) throw new Error("no provider");
		const hits = await prom.search("books", ctx(["alert", "alert_rule"]));
		expect(hits.map((h) => [h.ref.kind, h.ref.label, h.detail])).toEqual([
			["alert_rule", "BooksSlow", "firing · books"],
			["alert", "BooksSlow", "firing · Prometheus"],
		]);
		const rule = await prom.snapshot({ kind: "alert_rule", id: "p1:books/BooksSlow", label: "BooksSlow" });
		expect(rule?.text).toContain("Expression: p99 > 2");
	});

	it("Given a connection with no usable credential and one that does not answer, Then each is one line and the stored alerts still answer", async () => {
		const providers = monitoringProviders(
			sources({
				alertmanager: [{ id: "c1", label: "prod", routes: "no token stored for this connection" }],
				prometheus: [
					{
						id: "p1",
						label: "metrics",
						routes: {
							"api/v1/alerts": () => {
								throw new Error("connect ECONNREFUSED 10.0.0.9:9090");
							},
						},
					},
				],
			}),
		);
		const stored = [{ id: "a1", title: "Stored BooksSlow", status: "firing" }];
		const run = { id: RUN, incidentId: null, repositoryId: null, serviceId: null, scheduleId: null, workspace: null, harness: null, agentCommands: null };
		// Every model answers empty but the run and the stored alerts.
		const prisma = new Proxy(
			{
				investigation: { findUnique: vi.fn(async () => run), findMany: vi.fn(async () => []) },
				alert: { findMany: vi.fn(async () => stored) },
			} as Record<string, unknown>,
			{
				get: (t, k: string) =>
					t[k] ?? {
						findMany: async () => [],
						findUnique: async () => null,
						findFirst: async () => null,
						upsert: async () => ({}),
					},
			},
		);
		const svc = new ReferencesService(prisma as never, providers);
		const result = await svc.search({ q: "", trigger: "@", threadId: RUN, limit: 20 });
		expect(result.unavailable.map((u) => u.source).sort()).toEqual(["Alertmanager", "Prometheus"]);
		expect(result.unavailable.find((u) => u.source === "Alertmanager")?.message).toContain(
			"no token stored",
		);
		expect(result.hits.map((h) => h.ref.label)).toContain("Stored BooksSlow");
	});

	it("Given two connections where one fails, Then the other's hits still come back", async () => {
		const [am] = monitoringProviders(
			sources({
				alertmanager: [
					{ id: "c1", label: "prod", routes: AM_ROUTES },
					{ id: "c2", label: "staging", routes: "the connection has no URL" },
				],
			}),
		);
		const hits = (await am?.search("", ctx(["alert"]))) ?? [];
		expect(hits.map((h) => [h.ref.id, h.group])).toEqual([["c1:f1", "Alertmanager · prod"]]);
	});

	it("Given odd answers, Then items without an id or name are skipped, a silence is named by its matchers, and a non-list answer is none", async () => {
		const [am, prom] = monitoringProviders(
			sources({
				alertmanager: [
					{
						id: "c1",
						label: "prod",
						routes: {
							"api/v2/alerts": [{ labels: { alertname: "NoPrint" } }, { fingerprint: "f2" }],
							"api/v2/silences": [
								{ id: "s2", matchers: [{ name: "env", value: "prod.*", isRegex: true, isEqual: false }] },
							],
						},
					},
				],
				prometheus: [
					{
						id: "p1",
						label: "metrics",
						routes: {
							"api/v1/rules": { data: { groups: [{ rules: [{ state: "inactive" }, { name: "Up", labels: null }] }] } },
							"api/v1/alerts": { data: {} },
						},
					},
				],
			}),
		);
		if (!am || !prom) throw new Error("no provider");
		const amHits = await am.search("", ctx(["alert", "silence"]));
		expect(amHits.map((h) => [h.ref.id, h.ref.label, h.detail])).toEqual([
			["c1:f2", "f2", "active · no severity"],
			["c1:s2", 'env!=~"prod.*"', "active until unknown"],
		]);
		expect((await prom.search("", ctx(["alert", "alert_rule"]))).map((h) => [h.ref.id, h.detail])).toEqual([
			["p1:/Up", "inactive · "],
		]);
		expect(await prom.search("", ctx(["silence"]))).toEqual([]);
		const notList = monitoringProviders(
			sources({ alertmanager: [{ id: "c1", label: "prod", routes: { "api/v2/alerts": { not: "a list" } } }] }),
		)[0];
		expect(await notList?.search("", ctx(["alert"]))).toEqual([]);
	});

	it("Given a snapshot of a ref it cannot read, Then it answers null, never throws", async () => {
		const [am] = monitoringProviders(
			sources({ alertmanager: [{ id: "c1", label: "prod", routes: { "api/v2/alerts": () => { throw new Error("down"); } } }] }),
		);
		if (!am) throw new Error("no provider");
		expect(await am.snapshot({ kind: "alert_rule", id: "c1:x", label: "x" })).toBeNull();
		expect(await am.snapshot({ kind: "alert", id: "no-colon", label: "x" })).toBeNull();
		expect(await am.snapshot({ kind: "alert", id: "c1:f1", label: "x" })).toBeNull();
		await expect(am.search("", ctx(["alert"]))).rejects.toMatchObject({ source: "Alertmanager" });
	});
});

