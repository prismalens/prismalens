// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseSourceCredential } from "@prismalens/contracts/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayService } from "./gateway.service.js";
import { LIMITS } from "./source-tools.js";

const RUN = "33333333-3333-4333-8333-333333333333";

interface Row {
	id: string;
	templateId: string;
	credentials: Record<string, string>;
	baseUrl: string;
}

const servers: Server[] = [];
afterEach(async () => {
	await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/** A fake upstream: answers by path, and echoes the request headers wherever asked. */
async function upstream(
	route: (req: IncomingMessage) => { status?: number; body: unknown },
): Promise<string> {
	const server = createServer((req, res) => {
		const { status = 200, body } = route(req);
		res.writeHead(status, { "content-type": "application/json" });
		res.end(typeof body === "string" ? body : JSON.stringify(body));
	});
	servers.push(server);
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function gateway(rows: Row[]) {
	const prisma = {
		setting: { findUnique: async () => null },
		serviceRepository: { count: async () => 0 },
		investigation: { findUnique: async () => null },
		connection: {
			findMany: async (args: {
				where?: { integration?: { templateId?: string } };
			}) =>
				rows
					.filter(
						(r) =>
							!args.where?.integration?.templateId ||
							r.templateId === args.where.integration.templateId,
					)
					.map((r) => ({
						id: r.id,
						label: r.id,
						status: "ACTIVE",
						lastErrorAt: null,
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
	const http = {
		httpAdapter: {
			getHttpServer: () => ({
				address: () => ({ address: "127.0.0.1", family: "IPv4", port: 3001 }),
			}),
		},
	};
	return new GatewayService(prisma as never, http as never, integrations as never);
}

let rpcId = 0;
async function call(
	g: GatewayService,
	method: string,
	params: Record<string, unknown> = {},
): Promise<{ text: string; isError: boolean; raw: Record<string, unknown> }> {
	const token = (await g.lease(RUN))?.token;
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
	const raw = JSON.parse(
		text.startsWith("{")
			? text
			: (text.split("\n").find((l) => l.startsWith("data: "))?.slice(6) ?? "{}"),
	) as Record<string, unknown>;
	const result = raw.result as
		| { content?: { text: string }[]; isError?: boolean }
		| undefined;
	return {
		text: result?.content?.[0]?.text ?? "",
		isError: result?.isError === true,
		raw,
	};
}

const tool = (g: GatewayService, name: string, args: Record<string, unknown>) =>
	call(g, "tools/call", { name, arguments: args });

describe("gateway source tools (#848 Phase 1)", () => {
	it("tools/list: every tool is read-only", async () => {
		const out = await call(gateway([]), "tools/list");
		const tools = (
			out.raw.result as {
				tools: { name: string; annotations?: { readOnlyHint?: boolean } }[];
			}
		).tools;
		expect(tools.map((t) => t.name).sort()).toEqual([
			"alertmanager_alerts",
			"investigations_search",
			"loki_query_range",
			"prometheus_alerts",
			"prometheus_query",
			"prometheus_query_range",
			"runbooks_list",
			"runbooks_read",
			"sources_list",
		]);
		expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
	});

	it("answers not-configured when no source of the kind is connected", async () => {
		const out = await tool(gateway([]), "loki_query_range", { query: "{app=\"x\"}" });
		expect(JSON.parse(out.text)).toMatchObject({ status: "not-configured" });
	});

	const kinds: [string, Record<string, string>, string[]][] = [
		["bearer", { kind: "bearer", token: "s3cret-bearer" }, ["s3cret-bearer"]],
		[
			"basic",
			{ kind: "basic", username: "amy", password: "s3cret-pass" },
			["s3cret-pass", Buffer.from("amy:s3cret-pass").toString("base64")],
		],
		[
			"header",
			{ kind: "header", name: "X-Scope-OrgID", value: "s3cret-tenant" },
			["s3cret-tenant"],
		],
	];
	for (const [name, credentials, secrets] of kinds)
		it(`${name}: reaches the upstream, and never appears in the tool result even when echoed`, async () => {
			const seen: Record<string, unknown>[] = [];
			const base = await upstream((req) => {
				seen.push(req.headers);
				return {
					body: {
						status: "success",
						data: {
							resultType: "vector",
							result: [{ metric: { echoed: JSON.stringify(req.headers) }, value: [1, "1"] }],
						},
					},
				};
			});
			const g = gateway([{ id: "p1", templateId: "prometheus", credentials, baseUrl: base }]);
			const out = await tool(g, "prometheus_query", { query: "up" });
			expect(out.isError).toBe(false);
			expect(JSON.stringify(seen)).toContain(secrets.at(-1));
			for (const s of secrets) expect(out.text).not.toContain(s);
			expect(out.text).toContain("[redacted]");
		});

	it("an upstream error body is scrubbed too", async () => {
		const base = await upstream((req) => ({
			status: 401,
			body: `bad token ${req.headers.authorization}`,
		}));
		const g = gateway([
			{ id: "p1", templateId: "prometheus", credentials: { kind: "bearer", token: "leaky-token" }, baseUrl: base },
		]);
		const out = await tool(g, "prometheus_query", { query: "up" });
		expect(out.isError).toBe(true);
		expect(out.text).not.toContain("leaky-token");
		expect(JSON.parse(out.text)).toMatchObject({ httpStatus: 401 });
	});

	for (const status of [401, 403, 500])
		it(`never forwards an upstream ${status} body, even an encoded credential (#848, OBJ-001)`, async () => {
			const base = await upstream((req) => ({
				status,
				body: `upstream-says ${Buffer.from(String(req.headers.authorization)).toString("hex")}`,
			}));
			const g = gateway([
				{ id: "p1", templateId: "prometheus", credentials: { kind: "bearer", token: "leaky-token" }, baseUrl: base },
			]);
			const out = await tool(g, "prometheus_query", { query: "up" });
			expect(out.isError).toBe(true);
			expect(out.text).not.toContain("upstream-says");
			expect(JSON.parse(out.text)).toEqual({
				source: "p1",
				httpStatus: status,
				error: `the source answered HTTP ${status}`,
			});
		});

	it("caps Prometheus series, points per series, and result characters", async () => {
		let shape: "series" | "points" | "huge" = "series";
		const base = await upstream(() => ({
			body: {
				status: "success",
				data: {
					resultType: "matrix",
					result:
						shape === "series"
							? Array.from({ length: 80 }, (_, i) => ({ metric: { i: String(i) }, values: [[1, "1"]] }))
							: shape === "points"
								? [{ metric: {}, values: Array.from({ length: 300 }, (_, t) => [t, "1"]) }]
								: [{ metric: { big: "z".repeat(LIMITS.resultChars * 2) }, values: [] }],
				},
			},
		}));
		const g = gateway([{ id: "p1", templateId: "prometheus", credentials: {}, baseUrl: base }]);
		const series = JSON.parse((await tool(g, "prometheus_query_range", { query: "up" })).text);
		expect(series.result).toHaveLength(LIMITS.series);
		expect(series.seriesDropped).toBe(30);
		shape = "points";
		const points = JSON.parse((await tool(g, "prometheus_query_range", { query: "up" })).text);
		expect(points.result[0].values).toHaveLength(LIMITS.pointsPerSeries);
		expect(points.pointsDropped).toBe(100);
		shape = "huge";
		const huge = (await tool(g, "prometheus_query", { query: "up" })).text;
		expect(huge.length).toBeLessThan(LIMITS.resultChars + 200);
		expect(huge).toContain("[truncated at");
	});

	it("caps an oversized upstream response", async () => {
		const base = await upstream(() => ({
			body: "x".repeat(LIMITS.responseBytes + 10),
		}));
		const g = gateway([{ id: "p1", templateId: "prometheus", credentials: {}, baseUrl: base }]);
		const out = await tool(g, "prometheus_query", { query: "up" });
		expect(out.isError).toBe(true);
		expect(out.text).toContain("larger than");
	});

	it("loki_query_range honours limit across streams and cuts long lines", async () => {
		let url = "";
		const base = await upstream((req) => {
			url = req.url ?? "";
			return {
				body: {
					status: "success",
					data: {
						resultType: "streams",
						result: Array.from({ length: 3 }, (_, s) => ({
							stream: { s: String(s) },
							values: Array.from({ length: 100 }, (_, i) => [
								String(i),
								i === 0 ? "y".repeat(5_000) : "line",
							]),
						})),
					},
				},
			};
		});
		const g = gateway([{ id: "l1", templateId: "loki", credentials: {}, baseUrl: base }]);
		const out = await tool(g, "loki_query_range", { query: "{app=\"x\"}", limit: 120 });
		const view = JSON.parse(out.text);
		const lines = view.result.flatMap((s: { values: unknown[] }) => s.values);
		expect(lines).toHaveLength(120);
		expect(lines[0][1].length).toBe(LIMITS.logLineChars + 1);
		expect(url).toContain("/loki/api/v1/query_range?");
		expect(url).toContain("limit=120");
	});

	it("a redirect off the source's host is reported, not followed", async () => {
		let otherHit = false;
		const other = await upstream(() => {
			otherHit = true;
			return { body: {} };
		});
		const redirecting = createServer((_req, res) => {
			res.writeHead(302, { location: `${other}/x` });
			res.end();
		});
		servers.push(redirecting);
		await new Promise<void>((r) => redirecting.listen(0, "127.0.0.1", r));
		const redirectBase = `http://127.0.0.1:${(redirecting.address() as AddressInfo).port}`;
		const g = gateway([
			{ id: "a1", templateId: "alertmanager", credentials: { kind: "bearer", token: "tkn-1234" }, baseUrl: redirectBase },
		]);
		const out = await tool(g, "alertmanager_alerts", {});
		expect(out.isError).toBe(true);
		expect(out.text).toContain("would leave the source's origin");
		expect(otherHit).toBe(false);
	});

	it("sources_list probes each source and names an unsupported kind clearly", async () => {
		const loki = await upstream((req) => ({ status: req.url === "/ready" ? 200 : 404, body: "ready" }));
		const am = await upstream(() => ({ status: 401, body: "no" }));
		const g = gateway([
			{ id: "prom-iam", templateId: "prometheus", credentials: { kind: "aws-sigv4" }, baseUrl: "http://127.0.0.1:1" },
			{ id: "am", templateId: "alertmanager", credentials: { kind: "bearer", token: "zzzz" }, baseUrl: am },
			{ id: "lk", templateId: "loki", credentials: {}, baseUrl: loki },
		]);
		const out = await call(g, "tools/call", { name: "sources_list", arguments: {} });
		const view = JSON.parse(out.text) as {
			category: string;
			status: string;
			tools: string[];
			sources: { id: string; status: string; reason?: string }[];
		}[];
		const metrics = view.find((v) => v.category === "metrics");
		const logs = view.find((v) => v.category === "logs");
		expect(metrics?.status).toBe("unreachable");
		expect(metrics?.sources).toEqual([
			{
				id: "prom-iam",
				label: "prom-iam",
				kind: "prometheus",
				status: "unreachable",
				reason: "AWS SigV4 / assume-role credentials are not supported yet.",
			},
			{
				id: "am",
				label: "am",
				kind: "alertmanager",
				status: "unreachable",
				reason: "the source answered HTTP 401",
			},
		]);
		expect(logs?.status).toBe("connected");
		expect(logs?.tools).toEqual(["loki_query_range"]);
		expect(out.text).not.toContain("zzzz");
	});

	it("a query tool on an unsupported kind says so instead of failing silently", async () => {
		const g = gateway([
			{ id: "p1", templateId: "prometheus", credentials: { kind: "github-app" }, baseUrl: "http://127.0.0.1:1" },
		]);
		const out = await tool(g, "prometheus_query", { query: "up" });
		expect(out.isError).toBe(true);
		expect(JSON.parse(out.text)).toMatchObject({
			status: "unreachable",
			reason: "GitHub App credentials are not supported yet.",
		});
	});
});
