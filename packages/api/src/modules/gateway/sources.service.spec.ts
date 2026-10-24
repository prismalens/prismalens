// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
	parseSourceCredential,
	SOURCE_TYPES,
	sourceType,
} from "@prismalens/contracts/schemas";
import { getTemplate } from "@prismalens/integrations";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import type { CredentialsService } from "../integrations/crypto/credentials.service.js";
import type { IntegrationsService } from "../integrations/integrations.service.js";
import type { GatewayService } from "./gateway.service.js";
import { McpProxy } from "./proxy/proxy.service.js";
import { SignIns } from "./sign-in.js";
import { detectSources, runProbes, SourcesService } from "./sources.service.js";

const servers: Server[] = [];
afterEach(async () => {
	await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function upstream(
	route: (req: IncomingMessage) => { status?: number; body: unknown },
): Promise<{ url: string; seen: IncomingMessage[] }> {
	const seen: IncomingMessage[] = [];
	const server = createServer((req, res) => {
		seen.push(req);
		const { status = 200, body } = route(req);
		res.writeHead(status, { "content-type": "application/json" });
		res.end(JSON.stringify(body));
	});
	servers.push(server);
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const loki = sourceType("loki");
const prometheus = sourceType("prometheus");
if (!loki || !prometheus) throw new Error("descriptors missing");

describe("descriptors against templates (#848)", () => {
	it("each names a real template and only kinds it accepts", () => {
		for (const t of SOURCE_TYPES) {
			const template = getTemplate(t.id);
			expect(template, t.id).toBeDefined();
			const accepted = template?.credentialKinds;
			if (accepted) for (const k of t.credentialKinds) expect(accepted).toContain(k);
			else expect(t.tokenField).toBeDefined();
		}
	});
});

describe("runProbes", () => {
	it("discovers the service label and queries logs by it", async () => {
		const { url, seen } = await upstream((req) =>
			req.url?.startsWith("/loki/api/v1/labels")
				? { body: { status: "success", data: ["job", "service_name", "level"] } }
				: { body: { data: { result: [{ value: [0, "1204"] }] } } },
		);
		const report = await runProbes({
			type: loki,
			url,
			credential: parseSourceCredential({ kind: "bearer", token: "s3cret" }),
		});
		expect(report.ok).toBe(true);
		expect(report.discovered.serviceLabel).toBe("service_name");
		expect(report.probes.map((p) => [p.id, p.ok, p.detail])).toEqual([
			["labels", true, "3 labels"],
			["query", true, "1,204 lines in 5m"],
		]);
		expect(decodeURIComponent(seen[1]?.url ?? "")).toContain('{service_name=~".+"}[5m]');
		expect(seen.every((r) => r.headers.authorization === "Bearer s3cret")).toBe(true);
	});

	it("fails a required probe with a reason and passes over a failed optional one", async () => {
		const { url } = await upstream((req) =>
			req.url?.includes("alerts")
				? { status: 403, body: {} }
				: req.url?.includes("labels")
					? { body: { data: ["app"] } }
					: { body: { status: "success" } },
		);
		const report = await runProbes({
			type: prometheus,
			url,
			credential: parseSourceCredential({}),
		});
		expect(report.ok).toBe(true);
		expect(report.discovered.serviceLabel).toBe("app");
		expect(report.probes.find((p) => p.id === "alerts")).toMatchObject({
			need: "optional",
			ok: false,
			detail: "403: the credential cannot read this",
		});

		const denied = await upstream(() => ({ status: 401, body: {} }));
		const failed = await runProbes({
			type: prometheus,
			url: denied.url,
			credential: parseSourceCredential({}),
		});
		expect(failed.ok).toBe(false);
		expect(failed.probes[0]?.detail).toMatch(/^401/);
	});

	it("says why when nothing answers", async () => {
		const report = await runProbes(
			{ type: prometheus, url: "http://127.0.0.1:1", credential: parseSourceCredential({}) },
			{ timeoutMs: 2000 },
		);
		expect(report.ok).toBe(false);
		expect(report.probes[0]?.detail).toBe("could not connect to the source");
	});
});

describe("detectSources", () => {
	it("offers a URL from the environment and names a token without its value", () => {
		const found = detectSources({
			PROMETHEUS_URL: "http://prom:9090",
			GITHUB_TOKEN: "ghp_secret",
			LOKI_URL: "not a url",
		});
		expect(found).toEqual([
			{ type: "prometheus", env: "PROMETHEUS_URL", url: "http://prom:9090" },
			{ type: "github-token", env: "GITHUB_TOKEN", url: "https://api.github.com" },
		]);
		expect(JSON.stringify(found)).not.toContain("ghp_secret");
	});
});

function service(over: { integrations?: Partial<IntegrationsService> } = {}) {
	const prisma = {
		integration: { findFirst: vi.fn(async () => ({ id: "int-1" })) },
		connection: { findMany: vi.fn(async () => []) },
	} as unknown as PrismaService;
	const integrations = {
		createConnection: vi.fn(async () => ({ id: "conn-1" })),
		createIntegration: vi.fn(),
		...over.integrations,
	} as unknown as IntegrationsService;
	const svc = new SourcesService(
		prisma,
		integrations,
		{} as CredentialsService,
		{} as GatewayService,
		new SignIns(),
		{} as McpProxy,
	);
	return { svc, integrations };
}

describe("SourcesService.connect", () => {
	it("saves a source whose required probes pass, with the URL and service label", async () => {
		const { url } = await upstream((req) =>
			req.url?.includes("labels")
				? { body: { data: ["service_name"] } }
				: { body: { data: { result: [] } } },
		);
		const { svc, integrations } = service();
		const out = await svc.connect({ type: "loki", url, credential: { kind: "none" } });
		expect(out.connectionId).toBe("conn-1");
		expect(integrations.createConnection).toHaveBeenCalledWith({
			integrationId: "int-1",
			label: `Loki ${new URL(url).host}`,
			credentials: { kind: "none" },
			connectionConfig: { baseUrl: url, serviceLabel: "service_name" },
		});
	});

	it("saves nothing when a required probe fails", async () => {
		const { url } = await upstream(() => ({ status: 401, body: {} }));
		const { svc, integrations } = service();
		await expect(
			svc.connect({ type: "prometheus", url, credential: { kind: "none" } }),
		).rejects.toThrow(/Not connected: Run a query failed \(401/);
		expect(integrations.createConnection).not.toHaveBeenCalled();
	});

	it("sends a detected token only to the vendor's own host", async () => {
		const { svc } = service();
		svc.env = { GITHUB_TOKEN: "ghp_x" };
		await expect(
			svc.test({ type: "github-token", url: "http://evil.example", useDetected: true }),
		).rejects.toThrow(/only sent to https:\/\/api.github.com/);
		svc.env = {};
		await expect(
			svc.test({ type: "github-token", url: "https://api.github.com", useDetected: true }),
		).rejects.toThrow(/Nothing was detected/);
	});

	it("refuses a kind the type does not take", async () => {
		const { svc } = service();
		await expect(
			svc.test({ type: "github-token", url: "https://api.github.com", credential: { kind: "none" } }),
		).rejects.toThrow(/does not take none/);
	});
});

describe("MCP connection names stay unique (#848, OBJ-026)", () => {
	it("two pending sign-ins with the same name: the second to finish is refused", async () => {
		const saved: { id: string; name: string }[] = [];
		const finishers: ((c: unknown) => Promise<string>)[] = [];
		const prisma = {
			integration: { findFirst: vi.fn(async () => ({ id: "int-1" })) },
			connection: { findMany: vi.fn(async () => []) },
		} as unknown as PrismaService;
		const integrations = {
			createConnection: vi.fn(
				async (dto: { connectionConfig?: Record<string, string> }) => {
					const id = `conn-${saved.length + 1}`;
					saved.push({ id, name: dto.connectionConfig?.name ?? "" });
					return { id };
				},
			),
			createIntegration: vi.fn(),
		} as unknown as IntegrationsService;
		const proxy = {
			connections: async () => saved.map((s) => ({ ...s })),
			startSignIn: async (p: { onSignedIn: (c: unknown) => Promise<string> }) => {
				finishers.push(p.onSignedIn);
				return {
					state: `s${finishers.length}`,
					authorizationUrl: "https://as.test/authorize",
					complete: async () => ({ connectionId: "x" }),
				};
			},
		} as unknown as McpProxy;
		const svc = new SourcesService(
			prisma,
			integrations,
			{} as CredentialsService,
			{} as GatewayService,
			new SignIns(),
			proxy,
		);
		const draft = (url: string) => ({
			draft: { type: "mcp-server", url, name: "n8n_prod", description: "workflows" },
		});
		await svc.oauthStart(draft("https://prod.n8n.test/mcp"), "https://pl.example");
		await svc.oauthStart(draft("https://staging.n8n.test/mcp"), "https://pl.example");
		const credential = { kind: "mcp-oauth", serverUrl: "https://x", redirectUri: "https://pl.example/cb" };
		await expect(finishers[0]?.(credential)).resolves.toBe("conn-1");
		await expect(finishers[1]?.(credential)).rejects.toThrow(/already named n8n_prod/);
		expect(saved.map((s) => s.name)).toEqual(["n8n_prod"]);
	});
});
