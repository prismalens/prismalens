// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The Impact chart and fix check (#811) against a fake Prometheus HTTP server and a temp SQLite
 * database: expression states, series scope, budgets, concurrency and check eligibility.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-impact-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { ChangeEventsService } = await import("../changes/change-events.service.js");
const { ImpactService, SERIES_LIMIT } = await import("./impact.service.js");

type Json = Record<string, unknown>;
interface Fake {
	rules: (name: string) => Json[];
	range: (query: string) => Json[] | "slow" | "huge";
	instant: (query: string, params: URLSearchParams) => Json[];
}

const HOUR = 3_600_000;
const EXPR = 'node_load1{job="node"} > 4';
const RULE = { type: "alerting", name: "HighLoad", query: EXPR, labels: { severity: "page" } };

describe("ImpactService", () => {
	let prisma: InstanceType<typeof PrismaService>;
	let impact: InstanceType<typeof ImpactService>;
	let server: Server;
	let baseUrl: string;
	let connectionId: string;
	let connected = true;
	let fake: Fake;
	let active = 0;
	let maxActive = 0;
	const seen: string[] = [];

	function send(res: import("node:http").ServerResponse, data: Json) {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ status: "success", data }));
	}

	async function handle(req: IncomingMessage, res: import("node:http").ServerResponse) {
		const url = new URL(req.url ?? "/", "http://x");
		seen.push(url.pathname + url.search);
		active++;
		maxActive = Math.max(maxActive, active);
		try {
			await new Promise((r) => setTimeout(r, 20));
			const q = url.searchParams.get("query") ?? "";
			if (url.pathname.endsWith("/api/v1/rules"))
				return send(res, { groups: [{ rules: fake.rules(url.searchParams.get("rule_name[]") ?? "") }] });
			if (url.pathname.endsWith("/api/v1/query_range")) {
				const out = fake.range(q);
				if (out === "slow") return void (await new Promise((r) => setTimeout(r, 2000)));
				if (out === "huge")
					return send(res, { result: [{ metric: { pad: "x".repeat(3 * 1024 * 1024) }, values: [] }] });
				return send(res, { resultType: "matrix", result: out });
			}
			if (url.pathname.endsWith("/api/v1/query"))
				return send(res, { resultType: "vector", result: fake.instant(q, url.searchParams) });
			res.writeHead(404).end();
		} finally {
			active--;
		}
	}

	async function incidentWith(alert: {
		title?: string;
		sourceUrl?: string | null;
		labels?: Record<string, string>;
		status?: string;
		serviceId?: string;
	}) {
		const last = await prisma.incident.findFirst({ orderBy: { number: "desc" } });
		const incident = await prisma.incident.create({
			data: { number: (last?.number ?? 0) + 1, title: "load", serviceId: alert.serviceId },
		});
		const row = await prisma.alert.create({
			data: {
				dedupKey: `k-${incident.id}`,
				title: alert.title ?? "HighLoad",
				status: alert.status ?? "triggered",
				sourceUrl: alert.sourceUrl === undefined ? graph(EXPR) : alert.sourceUrl,
				labels: JSON.stringify(
					alert.labels ?? { alertname: "HighLoad", instance: "a:9100", job: "node", severity: "page" },
				),
				incidentId: incident.id,
				serviceId: alert.serviceId,
				triggeredAt: new Date(Date.now() - HOUR),
			},
		});
		return { incidentId: incident.id, alertId: row.id };
	}

	const graph = (expr: string, base = "http://am-sender.example:9090") =>
		`${base}/graph?g0.expr=${encodeURIComponent(expr)}&g0.tab=1`;

	const series = (instance: string, value = "5") => ({
		metric: { __name__: "node_load1", instance, job: "node" },
		values: [
			[Math.floor((Date.now() - 2 * HOUR) / 1000), "1"],
			[Math.floor((Date.now() - 3 * HOUR) / 1000), "3"],
			[Math.floor(Date.now() / 1000), value],
		],
	});

	beforeAll(async () => {
		const { resolveMigrationsDir, runMigrations } = await import("@prismalens/database/migrator");
		await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
		prisma = new PrismaService();
		await prisma.$connect();
		server = createServer((req, res) => void handle(req, res));
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		const integration = await prisma.integration.create({
			data: { templateId: "prometheus", label: "Prometheus" },
		});
		const conn = await prisma.connection.create({
			data: { integrationId: integration.id, label: "prom", credentialsEnc: Buffer.from("{}") },
		});
		connectionId = conn.id;
		const connectors = {
			resolve: async () =>
				connected
					? [{ templateId: "prometheus", connectionId, label: "prom", baseUrl, segments: ["metrics"] }]
					: [],
		};
		const integrations = { baseUrlOf: () => baseUrl };
		impact = new ImpactService(
			prisma,
			connectors as never,
			integrations as never,
			new ChangeEventsService(prisma, {} as never, {} as never),
		);
	});

	beforeEach(() => {
		connected = true;
		impact.deadlineMs = 10_000;
		seen.length = 0;
		fake = {
			rules: () => [RULE],
			range: () => [series("a:9100"), series("b:9100", "2")],
			instant: () => [
				{ metric: { instance: "a:9100", job: "node" }, value: [Date.now() / 1000, "5"] },
				{ metric: { instance: "b:9100", job: "node" }, value: [Date.now() / 1000, "1"] },
			],
		};
	});

	afterAll(async () => {
		await new Promise((r) => server?.close(r));
		await prisma?.$disconnect();
		rmSync(env.root, { recursive: true, force: true });
	});

	describe("chart", () => {
		it("re-runs the alert's own expression, splits the threshold and scopes to its series", async () => {
			const { incidentId } = await incidentWith({});
			const chart = await impact.chart(incidentId);
			expect(chart).toMatchObject({
				state: "ok",
				expression: { state: "recovered", reason: null },
				metric: { source: "alert", query: 'node_load1{job="node"}', threshold: { op: ">", value: 4 } },
				scope: { state: "scoped", matched: 1 },
				now: 5,
				usual: 2,
				connection: { id: connectionId, label: "prom" },
			});
			expect(chart?.series).toHaveLength(1);
			expect(chart?.series[0]?.labels.instance).toBe("a:9100");
			expect(chart?.linkOut).toContain("am-sender.example");
			const range = seen.find((p) => p.includes("query_range")) ?? "";
			expect(range).toContain("limit=50");
			expect(range).toContain("timeout=8s");
			expect(range).toContain("step=288");
			expect(seen.some((p) => p.includes("am-sender.example"))).toBe(false);
		});

		it("shows every series unscoped when no loaded rule has the exact expression", async () => {
			fake.rules = () => [{ ...RULE, query: `${EXPR} ` }];
			const { incidentId } = await incidentWith({});
			const chart = await impact.chart(incidentId);
			expect(chart?.scope).toEqual({ state: "unscoped", matched: 0 });
			expect(chart?.series).toHaveLength(2);
			expect(chart?.now).toBeNull();
		});

		it("uses the one rule loaded now for a catch-up alert, chart only and unscoped", async () => {
			const { incidentId } = await incidentWith({ sourceUrl: graph('ALERTS{alertname="HighLoad"}', baseUrl) });
			const chart = await impact.chart(incidentId);
			expect(chart).toMatchObject({
				state: "ok",
				expression: { state: "recovered_current_rule" },
				metric: { source: "alert_current_rule", query: 'node_load1{job="node"}' },
				scope: { state: "unscoped" },
			});
			expect(seen.some((p) => p.includes("ALERTS"))).toBe(false);
		});

		it("never charts ALERTS{} when the rule is gone or ambiguous", async () => {
			const { incidentId } = await incidentWith({ sourceUrl: graph('ALERTS{alertname="HighLoad"}', baseUrl) });
			fake.rules = () => [];
			expect(await impact.chart(incidentId)).toMatchObject({
				state: "expression_unknown",
				expression: { state: "expression_unknown", reason: "The rule is no longer loaded." },
				series: [],
			});
			fake.rules = () => [RULE, { ...RULE, query: "node_load1 > 8" }];
			const again = await impact.chart(incidentId);
			expect(again?.expression.reason).toBe("2 rules share this name.");
			expect(seen.some((p) => p.includes("query_range"))).toBe(false);
		});

		it("says expression unknown for a sender with no expression, with history and the link", async () => {
			const { incidentId } = await incidentWith({ sourceUrl: "https://grafana.example/alerting/1afz/edit" });
			const chart = await impact.chart(incidentId);
			expect(chart).toMatchObject({
				state: "expression_unknown",
				metric: null,
				linkOut: "https://grafana.example/alerting/1afz/edit",
				history: { alertCount: 1, refiresThisWeek: 0 },
			});
			expect(chart?.history.strip).toHaveLength(1);
		});

		it("falls back to the service's own metric, labelled as the service's", async () => {
			const svc = await prisma.service.create({ data: { name: "api-fallback" } });
			await prisma.serviceIntegration.create({
				data: { serviceId: svc.id, connectionId, config: JSON.stringify({ metric: "sum(rate(http_requests_total[5m]))" }) },
			});
			const { incidentId } = await incidentWith({ sourceUrl: null, serviceId: svc.id });
			const chart = await impact.chart(incidentId);
			expect(chart).toMatchObject({
				state: "ok",
				expression: { state: "expression_unknown" },
				metric: { source: "service", query: "sum(rate(http_requests_total[5m]))", threshold: null },
				scope: { state: "unscoped" },
			});
		});

		it("is not_configured with no Prometheus connection", async () => {
			connected = false;
			const { incidentId } = await incidentWith({});
			expect(await impact.chart(incidentId)).toMatchObject({
				state: "not_configured",
				expression: { state: "not_configured" },
				connection: null,
			});
		});

		it(`is too broad at ${SERIES_LIMIT} series and never truncates`, async () => {
			fake.range = () => Array.from({ length: SERIES_LIMIT }, (_, i) => series(`h${i}:9100`));
			const { incidentId } = await incidentWith({});
			expect(await impact.chart(incidentId)).toMatchObject({ state: "too_broad", series: [] });
		});

		it("is too broad past the 2 MB body cap", async () => {
			fake.range = () => "huge";
			const { incidentId } = await incidentWith({});
			expect(await impact.chart(incidentId)).toMatchObject({ state: "too_broad", series: [] });
		});

		it("times out at the one deadline", async () => {
			impact.deadlineMs = 300;
			fake.range = () => "slow";
			const { incidentId } = await incidentWith({});
			expect(await impact.chart(incidentId)).toMatchObject({ state: "timeout", series: [] });
		});

		it("runs at most two queries at once on one connection", async () => {
			while (active > 0) await new Promise((r) => setTimeout(r, 50));
			maxActive = 0;
			const ids: Array<{ incidentId: string }> = [];
			for (let i = 0; i < 4; i++) ids.push(await incidentWith({}));
			await Promise.all(ids.map((i) => impact.chart(i.incidentId)));
			expect(maxActive).toBeLessThanOrEqual(2);
		});

		it("shares one query between two requests for the same alert", async () => {
			const { incidentId } = await incidentWith({});
			await Promise.all([impact.chart(incidentId), impact.chart(incidentId)]);
			expect(seen.filter((p) => p.includes("query_range"))).toHaveLength(1);
		});
	});

	describe("check", () => {
		it("judges one instant at an explicit time on the alert's one series", async () => {
			const { incidentId } = await incidentWith({});
			expect(await impact.check(incidentId)).toMatchObject({
				verdict: "not_yet",
				value: 5,
				threshold: { op: ">", value: 4 },
				reason: null,
			});
			const q = seen.find((p) => p.startsWith("/api/v1/query?")) ?? "";
			expect(q).toContain("lookback_delta=300s");
			expect(q).toMatch(/time=\d+/);
			expect(seen.filter((p) => p.startsWith("/api/v1/query?"))).toHaveLength(1);
		});

		it("says below the threshold, never It worked, while the alert still fires", async () => {
			fake.instant = () => [{ metric: { instance: "a:9100", job: "node" }, value: [1, "0.5"] }];
			const { incidentId } = await incidentWith({});
			expect(await impact.check(incidentId)).toMatchObject({ verdict: "below_threshold", value: 0.5 });
		});

		it("says It worked only when the alert resolved", async () => {
			const { incidentId } = await incidentWith({ status: "resolved" });
			expect(await impact.check(incidentId)).toMatchObject({ verdict: "it_worked" });
			expect(seen).toHaveLength(0);
		});

		it.each([
			["a range function", graph('histogram_quantile(0.99, rate(h_bucket[5m])) > 0.5'), "range-function"],
			["a bool comparison", graph("node_load1 > bool 4"), "unsupported-shape"],
			["vector against vector", graph("node_load1 > node_cpus"), "unsupported-shape"],
			["the current rule", graph('ALERTS{alertname="HighLoad"}', "SELF"), "current-rule"],
			["no expression", null, "expression-unknown"],
		])("could not check %s", async (_name, sourceUrl, reason) => {
			const url = sourceUrl?.replace("SELF", baseUrl) ?? null;
			const { incidentId } = await incidentWith({ sourceUrl: url });
			expect(await impact.check(incidentId)).toMatchObject({
				verdict: "could_not_check",
				reason,
				message: "Could not check; the alert clears on its own.",
				retryable: false,
			});
			expect(seen.some((p) => p.startsWith("/api/v1/query?"))).toBe(false);
		});

		it("could not check when no loaded rule has the exact expression", async () => {
			fake.rules = () => [];
			const { incidentId } = await incidentWith({});
			expect(await impact.check(incidentId)).toMatchObject({ reason: "rule-not-matched" });
		});

		it("could not check when the series cannot be told apart", async () => {
			fake.instant = () => [
				{ metric: { job: "node" }, value: [1, "5"] },
				{ metric: { job: "node", instance: "a:9100" }, value: [1, "5"] },
			];
			const { incidentId } = await incidentWith({});
			expect(await impact.check(incidentId)).toMatchObject({ reason: "series-not-scoped" });
		});

		it("could not check a stale or missing value", async () => {
			fake.instant = () => [{ metric: { instance: "a:9100", job: "node" }, value: [1, "NaN"] }];
			const { incidentId } = await incidentWith({});
			expect(await impact.check(incidentId)).toMatchObject({ reason: "no-value" });
		});

		it("offers Try again after a refused query", async () => {
			connected = true;
			const { incidentId } = await incidentWith({});
			const broken = new ImpactService(
				prisma,
				{ resolve: async () => [{ templateId: "prometheus", connectionId, label: "p", baseUrl: "http://127.0.0.1:1", segments: [] }] } as never,
				{ baseUrlOf: () => null } as never,
				new ChangeEventsService(prisma, {} as never, {} as never),
			);
			expect(await broken.check(incidentId)).toMatchObject({
				verdict: "could_not_check",
				retryable: true,
			});
		});
	});
});
