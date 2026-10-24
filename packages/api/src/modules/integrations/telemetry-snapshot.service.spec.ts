// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseSourceCredential, SourcesPreRunSchema } from "@prismalens/contracts/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationsController } from "./integrations.controller.js";
import type { OpenedSource } from "./open-source.js";
import { mappingConfig, selectorMatchers } from "./source-query.js";
import {
	envSource,
	fetchSnapshot,
	type SnapshotSource,
	type SourceOutcome,
	TelemetrySnapshotService,
} from "./telemetry-snapshot.service.js";

const servers: Server[] = [];
afterEach(async () => {
	await Promise.all(
		servers.splice(0).map((s) => {
			s.closeAllConnections();
			return new Promise((r) => s.close(r));
		}),
	);
});

/** A fake upstream answering by path; `null` never answers. */
async function upstream(
	route: (req: IncomingMessage) => { status?: number; body: unknown } | null,
): Promise<string> {
	const server = createServer((req, res) => {
		const out = route(req);
		if (!out) return;
		res.writeHead(out.status ?? 200, { "content-type": "application/json" });
		res.end(JSON.stringify(out.body));
	});
	servers.push(server);
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const WINDOW = {
	start: new Date("2026-10-24T09:00:00Z"),
	end: new Date("2026-10-24T10:00:00Z"),
	service: "checkout",
};

interface Row {
	id: string;
	templateId: string;
	baseUrl: string;
	credentials: unknown;
}

function service(rows: Row[]) {
	const prisma = {
		connection: {
			findMany: async () =>
				rows.map((r) => ({
					id: r.id,
					label: r.id,
					integration: { templateId: r.templateId, label: r.templateId },
				})),
		},
	};
	const integrations = {
		connectionBaseUrl: async (id: string) =>
			rows.find((r) => r.id === id)?.baseUrl ?? null,
		sourceCredential: async (id: string) =>
			parseSourceCredential(rows.find((r) => r.id === id)?.credentials),
	};
	return new TelemetrySnapshotService(prisma as never, integrations as never);
}

const prometheus = (req: IncomingMessage) =>
	req.url?.startsWith("/api/v1/alerts")
		? {
				body: {
					data: { alerts: [{ labels: { alertname: "HighErrorRate" } }] },
				},
			}
		: { body: { data: { resultType: "vector", result: [{ metric: { job: "api" } }] } } };

describe("the pre-run telemetry fetch (#848 ruling 2026-10-24)", () => {
	it("reads Prometheus, Alertmanager and Loki with fixed read-only queries", async () => {
		const seen: string[] = [];
		const url = await upstream((req) => {
			seen.push(req.url ?? "");
			if (req.url?.startsWith("/api/v2/alerts"))
				return { body: [{ labels: { alertname: "A" } }, { labels: {} }] };
			if (req.url?.startsWith("/loki/"))
				return {
					body: {
						data: {
							result: [{ stream: { service_name: "checkout" }, values: [["1", "error x"]] }],
						},
					},
				};
			return prometheus(req);
		});
		const out = await fetchSnapshot(
			await service([
				{ id: "p", templateId: "prometheus", baseUrl: url, credentials: {} },
				{ id: "a", templateId: "alertmanager", baseUrl: url, credentials: {} },
				{ id: "l", templateId: "loki", baseUrl: url, credentials: {} },
			]).sources({}),
			WINDOW,
		);
		expect(out.map((o) => [o.kind, o.status, "part" in o ? o.part.summary : o.reason])).toEqual([
			["prometheus", "found", "1 alerts firing in the window, 1 scrape targets down in the window"],
			["alertmanager", "found", "2 active alerts in the window"],
			["loki", "found", '1 error log lines from 1 streams for {service_name="checkout"} (the default selector)'],
		]);
		const loki = new URL(seen.find((u) => u.startsWith("/loki/")) as string, url);
		expect(loki.searchParams.get("query")).toBe(
			'{service_name="checkout"} |~ "(?i)(error|exception|fatal|panic)"',
		);
		expect(loki.searchParams.get("start")).toBe(String(WINDOW.start.getTime() / 1000));
	});

	it("a source that does not answer in time is skipped, and the others still arrive", async () => {
		const slow = await upstream(() => null);
		const fast = await upstream(prometheus);
		const started = Date.now();
		// Two unmapped connections of one kind are not read (#848), so each comes from its own service.
		const out = await fetchSnapshot(
			[
				...(await service([{ id: "slow", templateId: "prometheus", baseUrl: slow, credentials: {} }]).sources({})),
				...(await service([{ id: "fast", templateId: "prometheus", baseUrl: fast, credentials: {} }]).sources({})),
			],
			WINDOW,
			{ timeoutMs: 300 },
		);
		expect(Date.now() - started).toBeLessThan(5_000);
		expect(out.map((o) => [o.label, o.status])).toEqual([
			["slow", "skipped"],
			["fast", "found"],
		]);
		expect(out[0]).toMatchObject({ reason: "the source did not answer in time" });
	});

	it("a source that hangs before its first request is skipped by the same limit", async () => {
		const hung: SnapshotSource = {
			kind: "loki",
			label: "hung",
			from: "set",
			open: () => new Promise<OpenedSource>(() => {}),
		};
		const [out] = await fetchSnapshot([hung], WINDOW, { timeoutMs: 100 });
		expect(out).toMatchObject({ status: "skipped", reason: "the source did not answer in time" });
	});

	it("a saved source whose credential is missing is skipped with PrismaLens's reason, and nothing is sent", async () => {
		let hits = 0;
		const url = await upstream(() => {
			hits++;
			return { body: {} };
		});
		const [out] = await fetchSnapshot(
			await service([
				{ id: "p", templateId: "prometheus", baseUrl: url, credentials: { kind: "bearer" } },
			]).sources({}),
			WINDOW,
		);
		expect(out?.status).toBe("skipped");
		expect(out).toMatchObject({ from: "set" });
		expect(hits).toBe(0);
	});

	it("a 401 is skipped and its body, which may echo the credential, is never read", async () => {
		const url = await upstream(() => ({ status: 401, body: { echo: "s3cret-token" } }));
		const [out] = await fetchSnapshot(
			await service([
				{ id: "p", templateId: "prometheus", baseUrl: url, credentials: { kind: "bearer", token: "s3cret-token" } },
			]).sources({}),
			WINDOW,
		);
		expect(out).toMatchObject({ status: "skipped", reason: "the source answered HTTP 401" });
		expect(JSON.stringify(out)).not.toContain("s3cret");
	});

	it("with nothing mapped, the only saved connection comes before the env, and the env serves a kind with none (#848)", async () => {
		const auth: (string | undefined)[] = [];
		const url = await upstream((req) => {
			auth.push(req.headers.authorization);
			return prometheus(req);
		});
		const saved = await service([
			{ id: "saved", templateId: "prometheus", baseUrl: url, credentials: {} },
		]).sources({ PROMETHEUS_URL: "http://127.0.0.1:1", PROMETHEUS_TOKEN: "env-token" });
		expect(saved.map((s) => [s.kind, s.label, s.from])).toEqual([["prometheus", "saved", "set"]]);
		const sources = await service([]).sources({ PROMETHEUS_URL: url, PROMETHEUS_TOKEN: "env-token" });
		expect(sources.map((s) => [s.kind, s.label, s.from])).toEqual([["prometheus", "PROMETHEUS_URL", "env"]]);
		const [prom] = await fetchSnapshot(sources, WINDOW);
		expect(prom).toMatchObject({ status: "found", secrets: ["env-token"] });
		expect(auth[0]).toBe("Bearer env-token");
	});

	it("an env URL that does not parse is skipped, never thrown", async () => {
		const src = envSource("loki", { LOKI_URL: "not a url" }) as SnapshotSource;
		const [out] = await fetchSnapshot([src], WINDOW);
		expect(out).toMatchObject({ status: "skipped", reason: "LOKI_URL is not a URL", from: "env" });
	});

	it("nothing configured reads nothing", async () => {
		expect(await service([]).sources({})).toEqual([]);
	});
});

describe("window-scoped telemetry queries and selectors (#848 C4)", () => {
	it("query: exact query strings, params, and time for Prometheus, Alertmanager and Loki", async () => {
		const seen: { path: string; params: Record<string, string | string[]> }[] = [];
		const url = await upstream((req) => {
			const parsed = new URL(req.url ?? "", "http://127.0.0.1");
			const params: Record<string, string | string[]> = {};
			for (const key of parsed.searchParams.keys()) {
				const vals = parsed.searchParams.getAll(key);
				params[key] = vals.length > 1 ? vals : vals[0]!;
			}
			seen.push({ path: parsed.pathname, params });
			if (parsed.pathname.startsWith("/api/v2/alerts")) {
				return { body: [{ startsAt: "2026-10-24T09:30:00Z", labels: { alertname: "DiskFull" } }] };
			}
			if (parsed.pathname.startsWith("/loki/")) {
				return {
					body: {
						data: {
							result: [{ stream: { app: "api" }, values: [["1792832500000000000", "error x"]] }],
						},
					},
				};
			}
			return {
				body: { data: { resultType: "vector", result: [{ metric: { app: "api" } }] } },
			};
		});

		const sources = await service([
			{ id: "p", templateId: "prometheus", baseUrl: url, credentials: {} },
			{ id: "a", templateId: "alertmanager", baseUrl: url, credentials: {} },
			{ id: "l", templateId: "loki", baseUrl: url, credentials: {} },
		]).sources({});
		const selector = '{app="api",env="prod"}';
		const out = await fetchSnapshot(
			sources.map((s) => ({ ...s, selector })),
			WINDOW,
		);
		expect(out.every((o) => o.status === "found")).toBe(true);

		const expectedTime = String(Math.floor(WINDOW.end.getTime() / 1000));
		const expectedDuration = Math.round((WINDOW.end.getTime() - WINDOW.start.getTime()) / 1000);

		const promFiring = seen.find((r) => r.path === "/api/v1/query" && typeof r.params.query === "string" && r.params.query.includes("ALERTS"));
		const promDown = seen.find((r) => r.path === "/api/v1/query" && typeof r.params.query === "string" && r.params.query.includes("up{"));
		expect(promFiring?.params).toEqual({
			query: `max_over_time(ALERTS{alertstate="firing",app="api",env="prod"}[${expectedDuration}s])`,
			time: expectedTime,
		});
		expect(promDown?.params).toEqual({
			query: `min_over_time(up{app="api",env="prod"}[${expectedDuration}s]) == 0`,
			time: expectedTime,
		});

		const amQuery = seen.find((r) => r.path === "/api/v2/alerts");
		expect(amQuery?.params).toEqual({
			active: "true",
			silenced: "false",
			inhibited: "false",
			filter: ['app="api"', 'env="prod"'],
		});

		const lokiQuery = seen.find((r) => r.path === "/loki/api/v1/query_range");
		expect(lokiQuery?.params).toEqual({
			query: '{app="api",env="prod"} |~ "(?i)(error|exception|fatal|panic)"',
			start: String(Math.floor(WINDOW.start.getTime() / 1000)),
			end: expectedTime,
			limit: "200",
			direction: "backward",
		});
	});

	it("query: selector is taken from config or uses the named default, and up has no braces without selector", async () => {
		const seen: string[] = [];
		const url = await upstream((req) => {
			seen.push(req.url ?? "");
			if (req.url?.startsWith("/api/v2/alerts")) return { body: [] };
			if (req.url?.startsWith("/loki/")) return { body: { data: { result: [{ stream: { service_name: "checkout" }, values: [["1", "err"]] }] } } };
			return { body: { data: { resultType: "vector", result: [] } } };
		});
		const sources = await service([
			{ id: "p", templateId: "prometheus", baseUrl: url, credentials: {} },
			{ id: "l", templateId: "loki", baseUrl: url, credentials: {} },
		]).sources({});

		const outNoSelector = await fetchSnapshot(sources, WINDOW);
		const lokiNoSel = outNoSelector.find((o) => o.kind === "loki") as { part: { summary: string } };
		expect(lokiNoSel.part.summary).toContain("(the default selector)");
		expect(lokiNoSel.part.summary).toContain('{service_name="checkout"}');
		const promDownUrl = seen.find((u) => u.includes("min_over_time"));
		const promDownQuery = new URL(promDownUrl ?? "", "http://127.0.0.1").searchParams.get("query");
		expect(promDownQuery).toBe("min_over_time(up[3600s]) == 0");

		const parsedConfig = mappingConfig(JSON.stringify({ selector: '{app="order"}', extraKey: "custom" }));
		expect(parsedConfig).toEqual({ selector: '{app="order"}', extraKey: "custom" });

		const outWithSelector = await fetchSnapshot(
			sources.map((s) => ({ ...s, selector: parsedConfig.selector })),
			WINDOW,
		);
		const lokiWithSel = outWithSelector.find((o) => o.kind === "loki") as { part: { summary: string } };
		expect(lokiWithSel.part.summary).not.toContain("(the default selector)");
		expect(lokiWithSel.part.summary).toContain('{app="order"}');
	});

	it("query: a 100 KB label is cut to 512 characters", async () => {
		const longLabel = "x".repeat(100_000);
		const url = await upstream((req) => {
			if (req.url?.startsWith("/api/v2/alerts")) {
				return {
					body: [{ startsAt: "2026-10-24T09:30:00Z", labels: { env: longLabel }, annotations: { note: longLabel } }],
				};
			}
			if (req.url?.startsWith("/loki/")) {
				return {
					body: {
						data: {
							result: [{ stream: { tag: longLabel }, values: [["1", "err"]] }],
						},
					},
				};
			}
			return {
				body: {
					data: {
						resultType: "vector",
						result: [{ metric: { job: longLabel } }],
					},
				},
			};
		});
		const sources = await service([
			{ id: "p", templateId: "prometheus", baseUrl: url, credentials: {} },
			{ id: "a", templateId: "alertmanager", baseUrl: url, credentials: {} },
			{ id: "l", templateId: "loki", baseUrl: url, credentials: {} },
		]).sources({});
		const out = await fetchSnapshot(sources, WINDOW);
		const expectedCut = `${"x".repeat(512)}…`;
		const promPart = (out[0] as { part: { data: { firing: { result: [{ metric: { job: string } }] } } } }).part;
		const amPart = (out[1] as { part: { data: { alerts: [{ labels: { env: string }; annotations: { note: string } }] } } }).part;
		const lokiPart = (out[2] as { part: { data: { result: [{ stream: { tag: string } }] } } }).part;

		expect(promPart.data.firing.result[0]?.metric.job).toBe(expectedCut);
		expect(amPart.data.alerts[0]?.labels.env).toBe(expectedCut);
		expect(amPart.data.alerts[0]?.annotations.note).toBe(expectedCut);
		expect(lokiPart.data.result[0]?.stream.tag).toBe(expectedCut);
	});

	it("query: empty on a 200 response with no data", async () => {
		const url = await upstream((req) => {
			if (req.url?.startsWith("/api/v2/alerts")) return { body: [] };
			if (req.url?.startsWith("/loki/")) return { body: { data: { result: [] } } };
			return { body: { data: { resultType: "vector", result: [] } } };
		});
		const sources = await service([
			{ id: "p", templateId: "prometheus", baseUrl: url, credentials: {} },
			{ id: "a", templateId: "alertmanager", baseUrl: url, credentials: {} },
			{ id: "l", templateId: "loki", baseUrl: url, credentials: {} },
		]).sources({});
		const out = await fetchSnapshot(sources, WINDOW);
		expect(out.map((o) => [o.kind, o.status, "part" in o ? o.part.count : -1])).toEqual([
			["prometheus", "empty", 0],
			["alertmanager", "empty", 0],
			["loki", "empty", 0],
		]);
	});

	it("query: invalid selectors are refused and valid selectors are accepted", async () => {
		expect(selectorMatchers("up")).toBeNull();
		expect(selectorMatchers("{a=b}")).toBeNull();
		expect(selectorMatchers('{a="b"} or up')).toBeNull();
		expect(selectorMatchers('{a="b", c=~"x.*"}')).toEqual(['a="b"', 'c=~"x.*"']);

		const url = await upstream(prometheus);
		const [src] = await service([
			{ id: "p", templateId: "prometheus", baseUrl: url, credentials: {} },
		]).sources({});

		for (const invalid of ["up", "{a=b}", '{a="b"} or up']) {
			const [res] = await fetchSnapshot([{ ...src, selector: invalid }], WINDOW);
			expect(res).toMatchObject({
				status: "skipped",
				reason: expect.stringContaining("is not a label-matcher list like {app=\"api\"}"),
			});
		}

		const [valid] = await fetchSnapshot([{ ...src, selector: '{a="b", c=~"x.*"}' }], WINDOW);
		expect(valid?.status).toBe("found");
	});

	it("query: alerts outside the window are dropped", async () => {
		const url = await upstream((req) => {
			if (req.url?.startsWith("/api/v2/alerts")) {
				return {
					body: [
						{ alertname: "TooLate", startsAt: "2026-10-24T10:05:00Z" },
						{ alertname: "TooEarly", startsAt: "2026-10-24T08:00:00Z", endsAt: "2026-10-24T08:30:00Z" },
						{ alertname: "ActiveInWindow", startsAt: "2026-10-24T09:15:00Z" },
						{ alertname: "Overlapping", startsAt: "2026-10-24T08:30:00Z", endsAt: "2026-10-24T09:30:00Z" },
					],
				};
			}
			return { body: {} };
		});
		const [amSource] = await service([
			{ id: "a", templateId: "alertmanager", baseUrl: url, credentials: {} },
		]).sources({});
		const [out] = await fetchSnapshot([amSource], WINDOW);
		expect(out?.status).toBe("found");
		const data = (out as { part: { data: { alerts: { alertname: string }[] }; count: number } }).part;
		expect(data.count).toBe(2);
		expect(data.data.alerts.map((a) => a.alertname)).toEqual(["ActiveInWindow", "Overlapping"]);
	});
});

describe("connection selection and credential matrix (#848 C5)", () => {
	function mockPrisma(opts: {
		incident?: { id: string; service: { id: string; name: string } } | null;
		alerts?: { labels: string | object; service?: { id: string; name: string } }[];
		deployEvents?: { metadata: string | object }[];
		mappings?: {
			serviceId: string;
			connectionId: string;
			priority: number;
			config: unknown;
			isEnabled: boolean;
			connection: { id: string; label: string; status: string; integration: { templateId: string; label: string } };
		}[];
		activeConnections?: { id: string; label: string; integration: { templateId: string; label: string } }[];
		savedConnections?: { id: string; integration: { templateId: string } }[];
	}) {
		return {
			incident: {
				findUnique: async () => opts.incident ?? null,
			},
			alert: {
				findMany: async () =>
					(opts.alerts ?? []).map((a) => ({
						labels: typeof a.labels === "string" ? a.labels : JSON.stringify(a.labels),
						service: a.service ?? null,
					})),
			},
			changeEvent: {
				findFirst: async () => {
					const ev = (opts.deployEvents ?? [])[0];
					if (!ev) return null;
					return { metadata: typeof ev.metadata === "string" ? ev.metadata : JSON.stringify(ev.metadata) };
				},
			},
			serviceIntegration: {
				findMany: async () => opts.mappings ?? [],
			},
			connection: {
				findMany: async (args: { where: { status?: unknown } }) => {
					if (args.where?.status === "ACTIVE") {
						return opts.activeConnections ?? [];
					}
					return opts.savedConnections ?? opts.activeConnections ?? [];
				},
			},
		};
	}

	function mockIntegrations(conns: Record<string, {
		url?: string;
		state?: "set" | "absent" | "invalid";
		credential?: unknown;
	}>) {
		return {
			connectionBaseUrl: async (id: string) => conns[id]?.url ?? null,
			sourceCredential: async (id: string) => {
				const c = conns[id];
				if (!c) return { ok: false, state: "invalid" as const, reason: "invalid" as const, message: "not found" };
				const state = c.state ?? "set";
				if (state === "invalid") return { ok: false, state: "invalid" as const, reason: "invalid" as const, message: "invalid" };
				return {
					ok: true,
					state,
					credential: (c.credential ?? { kind: "bearer", token: "stored-token" }) as never,
				};
			},
		};
	}

	it("prod or staging is picked by an alert label, and by a deploy event", async () => {
		const connProd = { id: "c-prod", label: "Prod Prom", status: "ACTIVE", integration: { templateId: "prometheus", label: "Prometheus" } };
		const connStaging = { id: "c-staging", label: "Staging Prom", status: "ACTIVE", integration: { templateId: "prometheus", label: "Prometheus" } };
		const mappings = [
			{ serviceId: "svc-1", connectionId: "c-prod", priority: 10, config: { deployment: "prod" }, isEnabled: true, connection: connProd },
			{ serviceId: "svc-1", connectionId: "c-staging", priority: 10, config: { deployment: "staging" }, isEnabled: true, connection: connStaging },
		];

		// Alert label picks staging
		const prismaAlert = mockPrisma({
			incident: { id: "inc-1", service: { id: "svc-1", name: "api" } },
			alerts: [{ labels: { env: "staging" } }],
			mappings,
		});
		const svcAlert = new TelemetrySnapshotService(prismaAlert as never);
		const outAlert = await svcAlert.select("inc-1");
		expect(outAlert.units[0]?.facts?.connectionId).toBe("c-staging");
		expect(outAlert.units[0]?.facts?.selection).toMatchObject({ rule: "tag-match", deployment: "staging", tagFrom: "alert" });

		// Deploy event picks prod
		const prismaDeploy = mockPrisma({
			incident: { id: "inc-2", service: { id: "svc-1", name: "api" } },
			deployEvents: [{ metadata: { environment: "prod" } }],
			mappings,
		});
		const svcDeploy = new TelemetrySnapshotService(prismaDeploy as never);
		const outDeploy = await svcDeploy.select("inc-2");
		expect(outDeploy.units[0]?.facts?.connectionId).toBe("c-prod");
		expect(outDeploy.units[0]?.facts?.selection).toMatchObject({ rule: "tag-match", deployment: "prod", tagFrom: "deploy-event" });

		// Alert label wins over deploy event
		const prismaBoth = mockPrisma({
			incident: { id: "inc-3", service: { id: "svc-1", name: "api" } },
			alerts: [{ labels: { env: "staging" } }],
			deployEvents: [{ metadata: { environment: "prod" } }],
			mappings,
		});
		const svcBoth = new TelemetrySnapshotService(prismaBoth as never);
		const outBoth = await svcBoth.select("inc-3");
		expect(outBoth.units[0]?.facts?.connectionId).toBe("c-staging");
		expect(outBoth.units[0]?.facts?.selection.tagFrom).toBe("alert");
	});

	it("a stored tag 'prod-eu ' matches the alert prod-eu", async () => {
		const conn = { id: "c-eu", label: "EU Prom", status: "ACTIVE", integration: { templateId: "prometheus", label: "Prometheus" } };
		const prisma = mockPrisma({
			incident: { id: "inc-1", service: { id: "svc-1", name: "api" } },
			alerts: [{ labels: { environment: "prod-eu" } }],
			mappings: [
				{ serviceId: "svc-1", connectionId: "c-eu", priority: 1, config: { deployment: "prod-eu " }, isEnabled: true, connection: conn },
			],
		});
		const svc = new TelemetrySnapshotService(prisma as never);
		const out = await svc.select("inc-1");
		expect(out.units[0]?.facts?.connectionId).toBe("c-eu");
		expect(out.units[0]?.facts?.selection.rule).toBe("tag-match");
	});

	it("env is ignored when a connection is mapped", async () => {
		const conn = { id: "c-mapped", label: "Mapped Prom", status: "ACTIVE", integration: { templateId: "prometheus", label: "Prometheus" } };
		const prisma = mockPrisma({
			incident: { id: "inc-1", service: { id: "svc-1", name: "api" } },
			mappings: [
				{ serviceId: "svc-1", connectionId: "c-mapped", priority: 1, config: {}, isEnabled: true, connection: conn },
			],
		});
		const svc = new TelemetrySnapshotService(prisma as never);
		const out = await svc.select("inc-1", {
			PROMETHEUS_URL: "http://env-prom:9090",
			PROMETHEUS_TOKEN: "env-tok",
		});
		expect(out.units[0]?.label).toBe("Mapped Prom");
		expect(out.units[0]?.from).toBe("set");
	});

	it("two unmapped connections give 'map one'", async () => {
		const prisma = mockPrisma({
			incident: { id: "inc-1", service: { id: "svc-1", name: "checkout" } },
			activeConnections: [
				{ id: "c1", label: "Prom 1", integration: { templateId: "prometheus", label: "Prometheus" } },
				{ id: "c2", label: "Prom 2", integration: { templateId: "prometheus", label: "Prometheus" } },
			],
		});
		const svc = new TelemetrySnapshotService(prisma as never);
		const out = await svc.select("inc-1");
		expect(out.units).toEqual([]);
		expect(out.skipped).toEqual([
			expect.objectContaining({
				kind: "prometheus",
				status: "skipped",
				reason: "2 prometheus connections, none mapped to checkout: map one on the service",
			}),
		]);
	});

	it("a REVOKED sole connection does not fall back", async () => {
		const prisma = mockPrisma({
			incident: { id: "inc-1", service: { id: "svc-1", name: "checkout" } },
			activeConnections: [],
			savedConnections: [],
		});
		const svc = new TelemetrySnapshotService(prisma as never);
		const out = await svc.select("inc-1", {});
		expect(out.units).toEqual([]);
		expect(out.notConfigured).toEqual(expect.arrayContaining([{ kind: "prometheus", services: ["checkout"] }]));
	});

	it("config.enabled: false excludes the connection, and env then carries mappedOff", async () => {
		const conn = { id: "c-off", label: "Off Prom", status: "ACTIVE", integration: { templateId: "prometheus", label: "Prometheus" } };
		const prisma = mockPrisma({
			incident: { id: "inc-1", service: { id: "svc-1", name: "checkout" } },
			mappings: [
				{ serviceId: "svc-1", connectionId: "c-off", priority: 1, config: { enabled: false }, isEnabled: true, connection: conn },
			],
			activeConnections: [conn],
		});
		const svc = new TelemetrySnapshotService(prisma as never);
		const out = await svc.select("inc-1", {
			PROMETHEUS_URL: "http://env-prom:9090",
			PROMETHEUS_TOKEN: "env-tok",
		});
		expect(out.units[0]?.from).toBe("env");
		expect(out.units[0]?.facts?.selection).toMatchObject({ rule: "env", mappedOff: true });
		expect(out.units[0]?.facts?.selectedBy).toContain("every connection mapped to checkout is turned off");
	});

	it("credential matrix: set beats same-origin env token, explicit none, absent same-origin, cross-origin/port, and invalid", async () => {
		const origin = "http://127.0.0.1:9090";
		const conn = { id: "c1", label: "Prom", status: "ACTIVE", integration: { templateId: "prometheus", label: "Prometheus" } };
		const prisma = mockPrisma({
			activeConnections: [conn],
		});

		// 1. set beats same-origin env token, with overridesEnv
		const intSet = mockIntegrations({
			c1: { url: origin, state: "set", credential: { kind: "bearer", token: "stored-token" } },
		});
		const svcSet = new TelemetrySnapshotService(prisma as never, intSet as never);
		const [unitSet] = (await svcSet.select(undefined, { PROMETHEUS_URL: origin, PROMETHEUS_TOKEN: "env-token" })).units;
		const openedSet = await unitSet!.open(1000);
		expect(openedSet.secrets).toContain("stored-token");
		expect(unitSet?.facts?.overridesEnv).toBe("PROMETHEUS_TOKEN");
		expect(unitSet?.facts?.credentialFrom).toBe("stored");

		// 2. explicit none
		const intNone = mockIntegrations({
			c1: { url: origin, state: "set", credential: { kind: "none" } },
		});
		const svcNone = new TelemetrySnapshotService(prisma as never, intNone as never);
		const [unitNone] = (await svcNone.select(undefined, { PROMETHEUS_URL: origin, PROMETHEUS_TOKEN: "env-token" })).units;
		const openedNone = await unitNone!.open(1000);
		expect(openedNone.secrets).toEqual([]);
		expect(unitNone?.facts?.credentialFrom).toBe("stored");
		expect(unitNone?.facts?.overridesEnv).toBe("PROMETHEUS_TOKEN");

		// 3. absent with a same-origin token
		const intAbsent = mockIntegrations({
			c1: { url: origin, state: "absent" },
		});
		const svcAbsent = new TelemetrySnapshotService(prisma as never, intAbsent as never);
		const [unitAbsent] = (await svcAbsent.select(undefined, { PROMETHEUS_URL: origin, PROMETHEUS_TOKEN: "env-token" })).units;
		const openedAbsent = await unitAbsent!.open(1000);
		expect(openedAbsent.secrets).toContain("env-token");
		expect(unitAbsent?.facts?.credentialFrom).toBe("env");
		expect(unitAbsent?.facts?.envVar).toBe("PROMETHEUS_TOKEN");

		// 4. absent with an http-versus-https token on the same host and port (sends nothing)
		const [unitHttps] = (await svcAbsent.select(undefined, { PROMETHEUS_URL: "https://127.0.0.1:9090", PROMETHEUS_TOKEN: "env-token" })).units;
		const openedHttps = await unitHttps!.open(1000);
		expect(openedHttps.secrets).toEqual([]);
		expect(unitHttps?.facts?.credentialFrom).toBe("none");

		// 5. absent with an other-port token (sends nothing)
		const [unitOtherPort] = (await svcAbsent.select(undefined, { PROMETHEUS_URL: "http://127.0.0.1:9091", PROMETHEUS_TOKEN: "env-token" })).units;
		const openedOtherPort = await unitOtherPort!.open(1000);
		expect(openedOtherPort.secrets).toEqual([]);
		expect(unitOtherPort?.facts?.credentialFrom).toBe("none");

		// 6. invalid
		const intInvalid = mockIntegrations({
			c1: { url: origin, state: "invalid" },
		});
		const svcInvalid = new TelemetrySnapshotService(prisma as never, intInvalid as never);
		const [unitInvalid] = (await svcInvalid.select(undefined, {})).units;
		const openedInvalid = await unitInvalid!.open(1000);
		expect(openedInvalid.unusable).toBeDefined();
	});

	it("a shared Loki connection with two selectors gives two units", async () => {
		const connLoki = { id: "c-loki", label: "Loki", status: "ACTIVE", integration: { templateId: "loki", label: "Loki" } };
		const prisma = mockPrisma({
			incident: { id: "inc-1", service: { id: "s1", name: "checkout" } },
			alerts: [{ labels: {}, service: { id: "s2", name: "billing" } }],
			mappings: [
				{ serviceId: "s1", connectionId: "c-loki", priority: 1, config: { selector: '{app="checkout"}' }, isEnabled: true, connection: connLoki },
				{ serviceId: "s2", connectionId: "c-loki", priority: 1, config: { selector: '{app="billing"}' }, isEnabled: true, connection: connLoki },
			],
		});
		const svc = new TelemetrySnapshotService(prisma as never);
		const out = await svc.select("inc-1");
		expect(out.units.map((u) => [u.kind, u.facts?.selector])).toEqual([
			["loki", '{app="checkout"}'],
			["loki", '{app="billing"}'],
		]);
	});

	it("8 units give 6 attempted and 2 not-read", async () => {
		const conns = Array.from({ length: 8 }, (_, i) => ({
			id: `c${i}`,
			label: `Prom ${i}`,
			status: "ACTIVE",
			integration: { templateId: "prometheus", label: "Prometheus" },
		}));
		const mappings = conns.map((c, i) => ({
			serviceId: `svc-${i}`,
			connectionId: c.id,
			priority: 1,
			config: {},
			isEnabled: true,
			connection: c,
		}));
		const prisma = mockPrisma({
			incident: { id: "inc-1", service: { id: "svc-0", name: "svc-0" } },
			alerts: conns.slice(1).map((_, i) => ({ labels: {}, service: { id: `svc-${i + 1}`, name: `svc-${i + 1}` } })),
			mappings,
		});
		const intMock = mockIntegrations(
			Object.fromEntries(conns.map((c) => [c.id, { url: "http://127.0.0.1:1" }])),
		);
		const svc = new TelemetrySnapshotService(prisma as never, intMock as never);
		const out = await svc.fetch("inc-1", WINDOW);
		const attempted = out.sources.filter((s) => s.status === "skipped" || s.status === "found" || s.status === "empty");
		const notRead = out.sources.filter(
			(s): s is SourceOutcome & { status: "not-read"; reason: string } =>
				s.status === "not-read",
		);
		expect(attempted.length).toBe(6);
		expect(notRead.length).toBe(2);
		expect(notRead[0]?.reason).toBe("over the 6-source limit");
	});

	it("a single unmapped connection carries selection.rule and credentialFrom", async () => {
		const conn = { id: "c-sole", label: "Sole Prom", status: "ACTIVE", integration: { templateId: "prometheus", label: "Prometheus" } };
		const prisma = mockPrisma({
			incident: { id: "inc-1", service: { id: "svc-1", name: "checkout" } },
			activeConnections: [conn],
		});
		const svc = new TelemetrySnapshotService(prisma as never);
		const out = await svc.select("inc-1");
		expect(out.units[0]?.facts?.selection.rule).toBe("only-unmapped");
		expect(out.units[0]?.facts?.credentialFrom).toBe("stored");
		expect(out.units[0]?.facts?.selectedBy).toBe("the only prometheus connection; not mapped to a service");
	});

	it("preservation: a single unmapped connection with no env is read", async () => {
		const url = await upstream(prometheus);
		const svc = service([
			{ id: "saved", templateId: "prometheus", baseUrl: url, credentials: {} },
		]);
		const [out] = await fetchSnapshot(await svc.sources({}), WINDOW);
		expect(out?.status).toBe("found");
	});
});

describe("GET /sources/pre-run and preview (#848 C16a)", () => {
	it("preview agrees with the snapshot selection for the service and deployment", async () => {
		const prisma = {
			service: {
				findUnique: vi.fn(async () => ({ id: "svc-1", name: "checkout" })),
			},
			serviceIntegration: {
				findMany: vi.fn(async (args: { where: { serviceId: unknown } }) => {
					if (typeof args.where.serviceId === "object" && args.where.serviceId !== null && "in" in args.where.serviceId) {
						return [
							{
								serviceId: "svc-1",
								connectionId: "conn-prom",
								priority: 10,
								isEnabled: true,
								config: { deployment: "prod", selector: 'job="checkout"' },
								connection: {
									id: "conn-prom",
									label: "Prod Prometheus",
									status: "ACTIVE",
									integration: { templateId: "prometheus", label: "Prometheus" },
								},
							},
						];
					}
					return [{ config: { deployment: "prod" } }];
				}),
			},
			connection: {
				findMany: vi.fn(async (args: { where: { status: unknown } }) => {
					if (args.where.status === "ACTIVE") {
						return [
							{
								id: "conn-prom",
								label: "Prod Prometheus",
								integration: { templateId: "prometheus", label: "Prometheus" },
							},
						];
					}
					return [{ id: "conn-prom", integration: { templateId: "prometheus" } }];
				}),
			},
			alert: {
				findMany: vi.fn(async () => [{ labels: JSON.stringify({ environment: "staging" }) }]),
			},
			changeEvent: {
				findMany: vi.fn(async () => [{ metadata: JSON.stringify({ env: "canary" }) }]),
			},
		};

		const integrations = {
			connectionBaseUrl: vi.fn(async () => "http://prom:9090"),
			sourceCredential: vi.fn(async () => ({ ok: true, credential: { kind: "none" }, state: "set" as const })),
		};

		const svc = new TelemetrySnapshotService(prisma as never, integrations as never);
		const env = { PROMETHEUS_URL: "http://prom:9090", PROMETHEUS_TOKEN: "tok" };

		const res = await svc.preview("svc-1", "prod", env);

		expect(SourcesPreRunSchema.safeParse(res).success).toBe(true);
		expect(res.deploymentsSeen).toEqual(["prod", "staging", "canary"]);

		const promKind = res.kinds.find((k) => k.kind === "prometheus");
		expect(promKind?.notConfigured).toBe(false);
		expect(promKind?.skipped).toBeNull();
		expect(promKind?.envFallback).toEqual({
			variable: "PROMETHEUS_URL",
			origin: "http://prom:9090",
			tokenSet: true,
		});
		expect(promKind?.units).toEqual([
			expect.objectContaining({
				kind: "prometheus",
				label: "Prod Prometheus",
				from: "set",
				connectionId: "conn-prom",
				credentialFrom: "stored",
				overridesEnv: "PROMETHEUS_TOKEN",
				services: ["checkout"],
				deployment: "prod",
				selector: 'job="checkout"',
				selection: expect.objectContaining({ rule: "tag-match", service: "checkout", priority: 10, deployment: "prod" }),
			}),
		]);

		const lokiKind = res.kinds.find((k) => k.kind === "loki");
		expect(lokiKind?.notConfigured).toBe(true);
		expect(lokiKind?.units).toEqual([]);

		const controller = new IntegrationsController({} as never, {} as never, {} as never, svc);
		const previewSpy = vi.spyOn(svc, "preview").mockResolvedValueOnce(res as never);
		const handler = (controller.sourcesPreRun() as any)["~orpc"].handler;
		const routeRes = await handler({ input: { serviceId: "svc-1", deployment: "prod" } });
		expect(previewSpy).toHaveBeenCalledWith("svc-1", "prod");
		expect(routeRes).toBe(res);

		const noSnapshotController = new IntegrationsController({} as never, {} as never, {} as never, undefined);
		const noHandler = (noSnapshotController.sourcesPreRun() as any)["~orpc"].handler;
		expect(() => noHandler({ input: { serviceId: "svc-1" } })).toThrow(
			"The pre-run preview is not available here",
		);
	});
});
