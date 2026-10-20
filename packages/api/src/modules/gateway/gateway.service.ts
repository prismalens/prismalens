// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AddressInfo } from "node:net";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Injectable, Optional } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { GatewayEntry } from "@prismalens/engine";
import { getTemplate } from "@prismalens/integrations";
import { Logger } from "@prismalens/logger";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import {
	credentialSecrets,
	type SourceRequestOptions,
	sourceRequestFn,
} from "../integrations/source-request.js";
import {
	CATEGORY_TOOLS,
	type GatewayData,
	gatewayMcpServer,
	type InvestigationsQuery,
	type PastInvestigation,
	SOURCE_CATEGORIES,
	type SourceStatus,
	type SourceView,
	TEMPLATE_CATEGORY,
} from "./gateway.tools.js";
import { bearerOf, RunTokens } from "./run-tokens.js";
import {
	failureReason,
	LIMITS,
	QUERY_KINDS,
	type QueryKind,
	type QuerySource,
} from "./source-tools.js";

/** sources_list's probe: cheap, read-only, short (#848). */
const PROBE_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 20_000;

/** The route, under the global `api` prefix: one path per run. */
export const GATEWAY_ROUTE = "mcp/runs/:runId";

const logger = new Logger({ context: "Gateway" });

/**
 * PrismaLens's read-only MCP doorway for the agents it launches (#848, ADR 0007 §5).
 * A run leases a bearer valid on its own path until the run ends.
 */
@Injectable()
export class GatewayService {
	private readonly tokens = new RunTokens();
	private readonly handler = createMcpHandler(
		({ authInfo }) => gatewayMcpServer(this.data, authInfo?.clientId ?? ""),
		{
			responseMode: "json",
			onerror: (e) => logger.warn(`gateway: ${e.message}`),
		},
	);

	constructor(
		private readonly prisma: PrismaService,
		@Optional() private readonly http?: HttpAdapterHost,
		@Optional() private readonly integrations?: IntegrationsService,
	) {}

	/** The run's gateway entry, or null when the api is not listening on a reachable address. */
	lease(runId: string): GatewayEntry | null {
		const base = this.baseUrl();
		if (!base) return null;
		return {
			url: `${base}/api/mcp/runs/${runId}`,
			token: this.tokens.mint(runId),
		};
	}

	revoke(runId: string): void {
		this.tokens.revoke(runId);
	}

	async serve(runId: string, request: Request): Promise<Response> {
		const token = bearerOf(request.headers.get("authorization"));
		if (!this.tokens.verify(runId, token)) {
			logger.info(`gateway: refused a request for run ${runId}`);
			return Response.json(
				{ error: "unauthorized" },
				{ status: 401, headers: { "WWW-Authenticate": "Bearer" } },
			);
		}
		return this.handler.fetch(request, {
			authInfo: { token: token as string, clientId: runId, scopes: [] },
		});
	}

	private baseUrl(): string | null {
		const server = this.http?.httpAdapter?.getHttpServer?.();
		const address = server?.address?.() as AddressInfo | string | null;
		if (!address || typeof address === "string") return null;
		const protocol = "setSecureContext" in server ? "https" : "http";
		const wildcard = ["0.0.0.0", "::", "::1"].includes(address.address);
		const host = wildcard
			? "127.0.0.1"
			: address.family === "IPv6"
				? `[${address.address}]`
				: address.address;
		return `${protocol}://${host}:${address.port}`;
	}

	readonly data: GatewayData = {
		sources: () => this.sources(),
		searchInvestigations: (q) => this.searchInvestigations(q),
		querySources: (kind) => this.querySources(kind),
	};

	private async querySources(kind: QueryKind): Promise<QuerySource[]> {
		const rows = await this.prisma.connection.findMany({
			where: {
				status: { not: "REVOKED" },
				integration: { templateId: kind },
			},
			select: {
				id: true,
				label: true,
				integration: { select: { label: true } },
			},
		});
		return Promise.all(
			rows.map((r) =>
				this.openSource(
					{ id: r.id, label: r.label || r.integration.label, kind },
					{ timeoutMs: QUERY_TIMEOUT_MS, maxBytes: LIMITS.responseBytes },
				),
			),
		);
	}

	/** A source's request function; its credential is decrypted here and never leaves the api. */
	private async openSource(
		src: { id: string; label: string; kind: QueryKind },
		opts: SourceRequestOptions,
	): Promise<QuerySource> {
		const unusable = (reason: string) => ({
			...src,
			secrets: [],
			unusable: reason,
		});
		if (!this.integrations)
			return unusable("PrismaLens cannot open this source here");
		const base = await this.integrations.connectionBaseUrl(src.id);
		if (!base) return unusable("the connection has no URL");
		const parsed = await this.integrations.sourceCredential(src.id);
		if (!parsed.ok) return unusable(parsed.message);
		return {
			...src,
			secrets: credentialSecrets(parsed.credential),
			request: sourceRequestFn(base, parsed, opts),
		};
	}

	/** Connected when the source's read-only verify path answers 2xx within the probe timeout. */
	private async probe(src: {
		id: string;
		label: string;
		kind: QueryKind;
	}): Promise<{ ok: true } | { ok: false; reason: string }> {
		const opened = await this.openSource(src, {
			timeoutMs: PROBE_TIMEOUT_MS,
			maxBytes: 64 * 1024,
		});
		if (!opened.request)
			return { ok: false, reason: opened.unusable ?? "unusable" };
		const verify = getTemplate(src.kind)?.verify ?? {
			method: "GET",
			path: "/",
		};
		try {
			const res = await opened.request(verify.method, verify.path);
			await res.body?.cancel();
			return res.ok
				? { ok: true }
				: { ok: false, reason: `the source answered HTTP ${res.status}` };
		} catch (e) {
			return { ok: false, reason: failureReason(e) };
		}
	}

	private async sources(): Promise<SourceView[]> {
		const rows = await this.prisma.connection.findMany({
			where: { status: { not: "REVOKED" } },
			select: {
				id: true,
				label: true,
				status: true,
				lastErrorAt: true,
				integration: { select: { templateId: true, label: true } },
			},
		});
		const queryable = (t: string): t is QueryKind =>
			(QUERY_KINDS as readonly string[]).includes(t);
		const probes = new Map(
			this.integrations
				? await Promise.all(
						rows
							.filter((r) => queryable(r.integration.templateId))
							.map(
								async (r) =>
									[
										r.id,
										await this.probe({
											id: r.id,
											label: r.label || r.integration.label,
											kind: r.integration.templateId as QueryKind,
										}),
									] as const,
							),
					)
				: [],
		);
		return SOURCE_CATEGORIES.map((category) => {
			if (category === "knowledge")
				return {
					category,
					status: "connected",
					sources: [
						{
							id: "prismalens-investigations",
							label: "Past PrismaLens investigations",
							kind: "builtin",
							status: "connected",
						},
					],
					tools: ["investigations_search"],
				};
			const sources = rows
				.filter((r) => TEMPLATE_CATEGORY[r.integration.templateId] === category)
				.map((r) => {
					const probed = probes.get(r.id);
					const status: SourceStatus = probed
						? probed.ok
							? "connected"
							: "unreachable"
						: r.status === "ACTIVE"
							? "connected"
							: "unreachable";
					return {
						id: r.id,
						label: r.label || r.integration.label,
						kind: r.integration.templateId,
						status,
						...(probed && !probed.ok ? { reason: probed.reason } : {}),
						...(!probed && status === "unreachable" && r.lastErrorAt
							? { lastErrorAt: r.lastErrorAt.toISOString() }
							: {}),
					};
				});
			const status: SourceStatus = sources.some((s) => s.status === "connected")
				? "connected"
				: sources.length
					? "unreachable"
					: "not-configured";
			return {
				category,
				status,
				sources,
				tools: CATEGORY_TOOLS[category] ?? [],
				...(status === "not-configured"
					? {
							howToConnect:
								"Connect one in PrismaLens under Settings, Integrations.",
						}
					: {}),
			};
		});
	}

	private async searchInvestigations(
		q: InvestigationsQuery,
	): Promise<PastInvestigation[]> {
		const text = { contains: q.query };
		const rows = await this.prisma.investigation.findMany({
			where: {
				id: { not: q.excludeRunId },
				status: "completed",
				OR: [
					{ summary: text },
					{ rootCause: text },
					{ title: text },
					{ incident: { title: text } },
					{ incident: { description: text } },
					{ incident: { actualCause: text } },
				],
				...(q.service
					? {
							incident: {
								service: {
									OR: [{ name: q.service }, { displayName: q.service }],
								},
							},
						}
					: {}),
			},
			orderBy: { completedAt: "desc" },
			take: q.limit,
			select: {
				id: true,
				completedAt: true,
				summary: true,
				rootCause: true,
				rootCauseCategory: true,
				incident: {
					select: {
						number: true,
						title: true,
						actualCause: true,
						actualCauseCategory: true,
						service: { select: { name: true } },
					},
				},
			},
		});
		return rows.map((r) => ({
			investigationId: r.id,
			incident: {
				number: r.incident.number,
				title: r.incident.title,
				service: r.incident.service?.name ?? null,
			},
			completedAt: r.completedAt?.toISOString() ?? null,
			agentFinding: {
				summary: r.summary,
				rootCause: r.rootCause,
				category: r.rootCauseCategory,
			},
			operatorRecordedCause: r.incident.actualCause
				? {
						cause: r.incident.actualCause,
						category: r.incident.actualCauseCategory,
					}
				: null,
		}));
	}
}
