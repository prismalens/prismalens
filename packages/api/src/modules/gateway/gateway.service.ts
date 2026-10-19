// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AddressInfo } from "node:net";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Injectable, Optional } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { GatewayEntry } from "@prismalens/engine";
import { Logger } from "@prismalens/logger";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
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
	};

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
					const status: SourceStatus =
						r.status === "ACTIVE" ? "connected" : "unreachable";
					return {
						id: r.id,
						label: r.label || r.integration.label,
						kind: r.integration.templateId,
						status,
						...(status === "unreachable" && r.lastErrorAt
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
				tools: [],
				...(status === "not-configured"
					? {
							howToConnect:
								category === "logs"
									? "PrismaLens has no logs integration yet."
									: "Connect one in PrismaLens under Settings, Integrations.",
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
