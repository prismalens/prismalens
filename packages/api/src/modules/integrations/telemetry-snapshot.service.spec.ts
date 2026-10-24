// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseSourceCredential } from "@prismalens/contracts/schemas";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenedSource } from "./open-source.js";
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
		expect(out.map((o) => [o.kind, o.status, o.status === "fetched" ? o.part.summary : o.reason])).toEqual([
			["prometheus", "fetched", "1 rule alerts pending or firing, 1 scrape targets down"],
			["alertmanager", "fetched", "2 active alerts"],
			["loki", "fetched", "1 error log lines from 1 streams"],
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
		const out = await fetchSnapshot(
			await service([
				{ id: "slow", templateId: "prometheus", baseUrl: slow, credentials: {} },
				{ id: "fast", templateId: "prometheus", baseUrl: fast, credentials: {} },
			]).sources({}),
			WINDOW,
			{ timeoutMs: 300 },
		);
		expect(Date.now() - started).toBeLessThan(5_000);
		expect(out.map((o) => [o.label, o.status])).toEqual([
			["slow", "skipped"],
			["fast", "fetched"],
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

	it("the env comes first: PROMETHEUS_URL and PROMETHEUS_TOKEN win over a saved Prometheus", async () => {
		const auth: (string | undefined)[] = [];
		const url = await upstream((req) => {
			auth.push(req.headers.authorization);
			return prometheus(req);
		});
		const sources = await service([
			{ id: "saved", templateId: "prometheus", baseUrl: "http://127.0.0.1:1", credentials: {} },
			{ id: "am", templateId: "alertmanager", baseUrl: url, credentials: {} },
		]).sources({ PROMETHEUS_URL: url, PROMETHEUS_TOKEN: "env-token" });
		expect(sources.map((s) => [s.kind, s.label, s.from])).toEqual([
			["prometheus", "PROMETHEUS_URL", "env"],
			["alertmanager", "am", "set"],
		]);
		const [prom] = await fetchSnapshot(sources.slice(0, 1), WINDOW);
		expect(prom).toMatchObject({ status: "fetched", secrets: ["env-token"] });
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
