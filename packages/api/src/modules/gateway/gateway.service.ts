// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AddressInfo } from "node:net";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import {
	RunWorkspaceSchema,
	type SourceCategoryView,
} from "@prismalens/contracts/schemas";
import {
	fenceUntrusted,
	type GatewayEntry,
	sanitizeUntrustedLine,
} from "@prismalens/engine";
import {
	getTemplate,
	noProxy,
	type ProxyPort,
	type SourceRegistry,
} from "@prismalens/integrations";
import { Logger } from "@prismalens/logger";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { openSource } from "../integrations/open-source.js";
import type { SourceRequestOptions } from "../integrations/source-request.js";
import { gatewayMcpServer, SOURCES_LIST } from "./mcp-delivery.js";
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
	type QueryKind,
	type QuerySource,
} from "./source-tools.js";
import {
	type ConnectionRow,
	labelOf,
	type RunView,
	remember,
	type SourceItem,
	sourceView,
} from "./source-view.js";
import {
	type GatewayToolData,
	gatewayRegistry,
	type InvestigationsQuery,
	type PastInvestigation,
} from "./tools/index.js";

/** sources_list's probe: cheap, read-only, short (#848). */
const PROBE_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 20_000;
/** How long `lease` waits for the vendor MCP servers to list their tools. */
const SNAPSHOT_BUDGET_MS = 5_000;

/** The route, under the global `api` prefix: one path per run. */
export const GATEWAY_ROUTE = "mcp/runs/:runId";

/** The vendor MCP proxy; bound by the module that provides it, `noProxy` otherwise. */
export const PROXY_PORT = Symbol.for("prismalens.gateway.ProxyPort");

const RUNBOOKS_SETTING = "sources.runbooks.enabled";

const logger = new Logger({ context: "Gateway" });

interface RunState extends RunView {
	confirmed: boolean;
	waiters: Set<(ok: boolean) => void>;
}

/**
 * PrismaLens's MCP doorway for the agents it launches (#848, ADR 0007 §5).
 * A run leases a bearer valid on its own path until the run ends.
 */
@Injectable()
export class GatewayService {
	private readonly tokens = new RunTokens();
	private readonly runs = new Map<string, RunState>();
	readonly registry: SourceRegistry;
	private readonly proxy: ProxyPort;
	private readonly handler = createMcpHandler(
		({ authInfo }) =>
			gatewayMcpServer(
				{
					registry: this.registry,
					proxy: this.proxy,
					sourcesList: (runId) => this.sourceView(runId),
					snapshot: (runId) =>
						this.runs.get(runId)?.snapshot ?? { connections: [] },
				},
				authInfo?.clientId ?? "",
			),
		{
			responseMode: "json",
			onerror: (e) => logger.warn(`gateway: ${e.message}`),
		},
	);

	constructor(
		private readonly prisma: PrismaService,
		@Optional() private readonly http?: HttpAdapterHost,
		@Optional() private readonly integrations?: IntegrationsService,
		@Optional() @Inject(PROXY_PORT) proxy?: ProxyPort,
	) {
		this.proxy = proxy ?? noProxy;
		this.registry = gatewayRegistry(this.data);
	}

	/**
	 * The run's gateway entry, or null when the api is not listening on a reachable
	 * address. The run's `seen` map starts with every connection that exists now.
	 */
	async lease(runId: string): Promise<GatewayEntry | null> {
		const base = this.baseUrl();
		if (!base) return null;
		const token = this.tokens.mint(runId);
		const state: RunState = {
			runId,
			// A follow-up's lease keeps what the run already met.
			seen: this.runs.get(runId)?.seen ?? new Map(),
			snapshot: { connections: [] },
			confirmed: false,
			waiters: new Set(),
		};
		this.runs.set(runId, state);
		remember(state.seen, await this.rows());
		state.snapshot = await this.proxy
			.snapshot(runId, SNAPSHOT_BUDGET_MS)
			.catch(() => ({ connections: [] }));
		const promptLine = gatewayPromptLine(
			await this.sourceView(runId, { probe: false }),
			state,
		);
		return {
			url: `${base}/api/mcp/runs/${runId}`,
			token,
			promptLine,
			tools: [SOURCES_LIST, ...this.registry.list().map((t) => t.name)],
			confirmed: () => state.confirmed,
			waitConfirmed: (ms) =>
				state.confirmed
					? Promise.resolve(true)
					: new Promise<boolean>((resolve) => {
							const done = (ok: boolean) => {
								clearTimeout(timer);
								state.waiters.delete(done);
								resolve(ok);
							};
							const timer = setTimeout(() => done(false), ms);
							state.waiters.add(done);
						}),
		};
	}

	revoke(runId: string): void {
		this.tokens.revoke(runId);
		this.proxy.close(runId);
		const state = this.runs.get(runId);
		this.runs.delete(runId);
		for (const done of state?.waiters ?? []) done(false);
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
		const state = this.runs.get(runId);
		if (state && !state.confirmed) {
			state.confirmed = true;
			for (const done of state.waiters) done(true);
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

	readonly data: GatewayToolData = {
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
		querySources: (kind, runId) => this.querySources(kind, runId),
	};

	/** Every category with its status. With a run id, removals the run saw read `removed` (OBJ-010). */
	sourceView(
		runId?: string,
		opts?: { probe?: boolean },
	): Promise<SourceCategoryView[]> {
		return sourceView(
			{
				rows: () => this.rows(),
				registry: this.registry,
				proxy: this.proxy,
				probe: this.integrations ? (src) => this.probe(src) : undefined,
				runbookSource: (id) => this.runbookSource(id),
			},
			runId ? this.runs.get(runId) : undefined,
			opts,
		);
	}

	/** The Sources page's answer; a run's `sources_list` is `sourceView(runId)`. */
	sources(runId?: string): Promise<SourceCategoryView[]> {
		return this.sourceView(runId);
	}

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

	private rows(): Promise<ConnectionRow[]> {
		return this.prisma.connection.findMany({
			where: { status: { not: "REVOKED" } },
			select: {
				id: true,
				label: true,
				status: true,
				lastErrorAt: true,
				integration: { select: { templateId: true, label: true } },
			},
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

	private async runbookSource(runId: string | undefined): Promise<SourceItem> {
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

	/** Rows are read per call, so a connection added or removed mid-run counts from the next call. */
	private async querySources(
		kind: QueryKind,
		runId: string,
	): Promise<QuerySource[]> {
		const rows = (await this.rows()).filter(
			(r) => r.integration.templateId === kind,
		);
		remember(this.runs.get(runId)?.seen, rows);
		return Promise.all(
			rows.map((r) =>
				this.openSource(
					{ id: r.id, label: labelOf(r), kind },
					{ timeoutMs: QUERY_TIMEOUT_MS, maxBytes: LIMITS.responseBytes },
				),
			),
		);
	}

	private async openSource(
		src: { id: string; label: string; kind: QueryKind },
		opts: SourceRequestOptions,
	): Promise<QuerySource> {
		if (!this.integrations)
			return {
				...src,
				secrets: [],
				unusable: "PrismaLens cannot open this source here",
			};
		return (await openSource(this.integrations, src, opts)) as QuerySource;
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

/** The prompt's tools paragraph (#848): what the run can call, built without probes. */
export function gatewayPromptLine(
	view: readonly SourceCategoryView[],
	run: Pick<RunView, "snapshot">,
): string {
	const lines = [
		"PrismaLens tools (MCP server `prismalens`). `sources_list` shows what this run can reach now.",
	];
	const reachable = view
		.filter((c) => c.category !== "mcp" && c.tools.length)
		.filter((c) => c.status !== "not-configured")
		.map((c) => `${c.category}: ${c.tools.map((t) => `\`${t}\``).join(", ")}`);
	if (reachable.length)
		lines.push(`PrismaLens tools (read-only): ${reachable.join("; ")}.`);
	const servers = run.snapshot.connections.filter(
		(c) => c.status === "connected" && c.tools.length,
	);
	if (servers.length)
		lines.push(
			fenceUntrusted(
				"MCP_SERVERS",
				"Names and descriptions an operator entered in PrismaLens.",
				`MCP servers connected in PrismaLens: ${servers
					.map(
						(c) =>
							`\`${c.name}\` (${sanitizeUntrustedLine(c.description)}, ${c.tools.length} tools)`,
					)
					.join(
						", ",
					)}. Their tools are named \`<server>__<tool>\` and follow your permission level.`,
			),
		);
	const missing = view
		.filter((c) => c.category !== "mcp" && c.status === "not-configured")
		.map((c) => c.category);
	if (missing.length) lines.push(`Not connected: ${missing.join(", ")}.`);
	return lines.join("\n");
}
