// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseSourceCredential } from "@prismalens/contracts/schemas";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenedSource } from "./open-source.js";
import { mappingConfig, selectorMatchers } from "./source-query.js";
import {
	envSource,
	fetchSnapshot,
	type SnapshotSource,
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
