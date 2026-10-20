// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AddressInfo } from "node:net";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Injectable, Optional } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import {
	RunWorkspaceSchema,
	UNSUPPORTED_KNOWLEDGE_VENDORS,
	UNSUPPORTED_SCM_VENDORS,
} from "@prismalens/contracts/schemas";
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
	type SourceCategory,
	type SourceStatus,
	type SourceView,
	TEMPLATE_CATEGORY,
} from "./gateway.tools.js";
import { bearerOf, RunTokens } from "./run-tokens.js";
import {
	listRunbooks,
	type RunbookEntry,
	type RunbookRepo,
	readRunbook,
} from "./runbooks.js";
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

const RUNBOOKS_SETTING = "sources.runbooks.enabled";

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
		sources: (runId) => this.sources(runId),
		runbooks: {
			list: async (runId, service) =>
				(await this.runbooksEnabled())
					? listRunbooks(await this.runbookRepos(runId), service)
					: [],
			read: async (runId, path, service) =>
				(await this.runbooksEnabled())
					? readRunbook(await this.runbookRepos(runId), path, service)
					: {
							ok: false,
							error: "Runbook discovery is turned off in PrismaLens.",
						},
		},
		searchInvestigations: (q) => this.searchInvestigations(q),
		querySources: (kind) => this.querySources(kind),
	};

	/** On unless the operator switched it off: the connect flow for runbooks is a toggle. */
	async runbooksEnabled(): Promise<boolean> {
		const row = await this.prisma.setting.findUnique({
			where: { key: RUNBOOKS_SETTING },
			select: { value: true },
		});
		return row?.value !== "false";
	}

	async setRunbooksEnabled(enabled: boolean): Promise<void> {
		await this.prisma.setting.upsert({
			where: { key: RUNBOOKS_SETTING },
			create: {
				key: RUNBOOKS_SETTING,
				value: String(enabled),
				type: "boolean",
				category: "sources",
			},
			update: { value: String(enabled) },
		});
	}

	/** The repos the run recorded, each at the commit it saw. */
	private async runbookRepos(runId: string): Promise<RunbookRepo[]> {
		const row = await this.prisma.investigation.findUnique({
			where: { id: runId },
			select: { workspace: true },
		});
		if (!row?.workspace) return [];
		try {
			const ws = RunWorkspaceSchema.safeParse(JSON.parse(row.workspace));
			return ws.success
				? ws.data.repos
						.filter((r) => r.services.length)
						.map((r) => ({
							name: r.name,
							dir: r.dir,
							head: r.head,
							subPath: r.subPath,
							services: r.services,
						}))
				: [];
		} catch {
			return [];
		}
	}

	private async runbookSource(
		runId: string | undefined,
	): Promise<SourceView["sources"][number]> {
		const base = {
			id: "runbooks",
			label: "Runbooks in your repos",
			kind: "builtin",
		};
		if (!(await this.runbooksEnabled()))
			return { ...base, status: "not-configured", reason: "Turned off." };
		let found: RunbookEntry[] | null = null;
		if (runId) found = await listRunbooks(await this.runbookRepos(runId));
		const bound = found
			? found.length
			: await this.prisma.serviceRepository.count();
		return bound
			? {
					...base,
					status: "connected",
					...(found ? { count: found.length } : {}),
				}
			: {
					...base,
					status: "not-configured",
					reason: "No runbooks found in the repos bound to services.",
				};
	}

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

	/** Every category with its status; the Sources page and `sources_list` read the same answer. */
	async sources(runId?: string): Promise<SourceView[]> {
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
		const runbooks = await this.runbookSource(runId);
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
						runbooks,
						...UNSUPPORTED_KNOWLEDGE_VENDORS.map((vendor) => ({
							id: vendor.toLowerCase(),
							label: vendor,
							kind: "unsupported",
							status: "not-configured" as const,
							reason: `${vendor} is not supported yet.`,
						})),
					],
					tools: CATEGORY_TOOLS.knowledge ?? [],
				};
			const connectable = rows
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
			const sources =
				category === "scm"
					? [
							...connectable,
							...UNSUPPORTED_SCM_VENDORS.map((vendor) => ({
								id: vendor.toLowerCase().replace(/ /g, "-"),
								label: vendor,
								kind: "unsupported",
								status: "not-configured" as const,
								reason: `${vendor} is not supported yet.`,
							})),
						]
					: connectable;
			const status: SourceStatus = connectable.some(
				(s) => s.status === "connected",
			)
				? "connected"
				: connectable.length
					? "unreachable"
					: "not-configured";
			return {
				category,
				status,
				sources,
				tools: CATEGORY_TOOLS[category] ?? [],
				...(status === "not-configured"
					? {
							howToConnect: howToConnect(category),
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

function howToConnect(category: SourceCategory): string {
	return category === "deploys"
		? "Send deploy events with `pl deploy` from the deploy job; see PrismaLens under Settings, Data sources."
		: `Connect one in PrismaLens under Settings, Data sources, or run \`pl connect ${category}\`.`;
}
