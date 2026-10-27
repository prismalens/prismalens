// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFile, realpath, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { isAbsolute, relative, resolve } from "node:path";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Injectable, Optional } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import {
	type QuoteAnchor,
	type RecordedFinding,
	type RunWorkspace,
	RunWorkspaceSchema,
} from "@prismalens/contracts/schemas";
import {
	FindingsLedger,
	type GatewayCall,
	type GatewayCallCount,
	type GatewayEntry,
	quoteLine,
} from "@prismalens/engine";
import {
	type HarnessTool,
	harnessMcpServer,
	harnessPromptLine,
	type RunView,
	runView,
} from "@prismalens/integrations/harness";
import { Logger } from "@prismalens/logger";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import { resolveServiceVersion } from "../../shared/utils/service-version.js";
import { bearerOf, RunTokens } from "./run-tokens.js";
import {
	listRunbooks,
	type RunbookEntry,
	type RunbookRepo,
	readRunbook,
} from "./runbooks.js";
import {
	type GatewayToolData,
	gatewayTools,
	type IncidentView,
	type InvestigationsQuery,
	type PastInvestigation,
} from "./tools/index.js";

/** The route, under the global `api` prefix: one path per run. */
export const GATEWAY_ROUTE = "mcp/runs/:runId";

const RUNBOOKS_SETTING = "sources.runbooks.enabled";
/** How far before the incident `incident_get` reads change events, and how many (#848). */
const CHANGES_BEFORE_MS = 24 * 3_600_000;
const CHANGES_TAKE = 20;
/** What the pre-run index reads: the first repos, one at a time, and the first entries (#848). */
const INDEX_REPOS = 5;
const INDEX_ENTRIES = 50;

export interface RunbookIndex {
	entries: RunbookEntry[];
	/** Why the scan did not run, when it did not. */
	skipped?: string;
}

const logger = new Logger({ context: "Gateway" });

interface RunState {
	connected: boolean;
	waiters: Set<(ok: boolean) => void>;
	calls: Map<string, GatewayCallCount>;
	listeners: Set<(c: GatewayCall) => void>;
	ledger: FindingsLedger;
	found: Set<(f: RecordedFinding) => void>;
	/** What this run lists and may execute (#848). */
	view: RunView;
}

const NO_TOOLS: RunView = { direct: [], deferred: [] };

/** The largest file a recorded quote is looked up in. */
const QUOTE_FILE_BYTES = 2_000_000;
const NOT_LIVE = "This run is not live, so nothing can be recorded on it";

/**
 * PrismaLens's MCP doorway for the agents it launches (#848, ADR 0007 §5): its own
 * harness tools only. A run leases a bearer valid on its own path until the run ends.
 */
@Injectable()
export class GatewayService {
	private readonly tokens = new RunTokens();
	private readonly runs = new Map<string, RunState>();
	/** Whether an agent's runs get a core plus `tools_search`: its registry row says (#848). */
	toolSearch = (harness?: string): boolean =>
		!!harness &&
		HARNESS_REGISTRY[harness as keyof typeof HARNESS_REGISTRY]
			?.harnessToolSearch === true;
	/** Every harness tool PrismaLens serves; each run gets a view of them. */
	readonly tools: readonly HarnessTool[];
	private readonly version = resolveServiceVersion();
	private readonly handler = createMcpHandler(
		({ authInfo }) => {
			const runId = authInfo?.clientId ?? "";
			return harnessMcpServer({
				runId,
				view: this.runs.get(runId)?.view ?? NO_TOOLS,
				version: this.version,
				onCall: (call) => this.called(runId, call),
			});
		},
		{
			responseMode: "json",
			onerror: (e) => logger.warn(`gateway: ${e.message}`),
		},
	);

	constructor(
		private readonly prisma: PrismaService,
		@Optional() private readonly http?: HttpAdapterHost,
	) {
		this.tools = gatewayTools(this.data);
	}

	/** The run's gateway entry, or null when the api is not listening on a reachable address. */
	async lease(
		runId: string,
		serverName: string,
		harness?: string,
	): Promise<GatewayEntry | null> {
		const base = this.baseUrl();
		if (!base) return null;
		const token = this.tokens.mint(runId);
		const state: RunState = {
			connected: false,
			waiters: new Set(),
			calls: new Map(),
			listeners: new Set(),
			ledger: new FindingsLedger(),
			found: new Set(),
			view: runView(this.tools, { search: this.toolSearch(harness) }),
		};
		this.runs.set(runId, state);
		const tools = [...state.view.direct, ...state.view.deferred].map(
			(t) => t.name,
		);
		return {
			url: `${base}/api/mcp/runs/${runId}`,
			token,
			serverName,
			promptLine: harnessPromptLine(state.view, serverName),
			tools,
			connected: () => state.connected,
			onCall: (listener) => {
				state.listeners.add(listener);
				return () => state.listeners.delete(listener);
			},
			calls: () => [...state.calls.values()].map((c) => ({ ...c })),
			sawOutput: (toolCallId, text) => {
				for (const e of state.ledger.sawOutput(toolCallId, text))
					this.recorded(state, { type: "evidence", ...e });
			},
			restore: (found) => state.ledger.restore(found),
			onFinding: (listener) => {
				state.found.add(listener);
				return () => state.found.delete(listener);
			},
			findings: () => state.ledger.snapshot(),
			waitConnected: (ms) =>
				state.connected
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
		const state = this.runs.get(runId);
		this.runs.delete(runId);
		for (const done of state?.waiters ?? []) done(false);
		state?.listeners.clear();
		state?.found.clear();
	}

	private recorded(state: RunState, finding: RecordedFinding): void {
		for (const listener of [...state.found]) listener(finding);
	}

	/** The line of the workspace file at `path` holding the quote; null when it is not there or outside the run's workspace. */
	private async fileAnchor(
		runId: string,
		path: string,
		quote: string,
	): Promise<QuoteAnchor | null> {
		const ws = await this.workspaceOf(runId);
		if (!ws) return null;
		const file = isAbsolute(path) ? path : resolve(ws.cwd, path);
		try {
			const real = await realpath(file);
			const roots = await Promise.all(
				[ws.cwd, ...ws.repos.map((r) => r.dir)].map((d) =>
					realpath(d).catch(() => null),
				),
			);
			// A path the agent names is read only inside the run's own copy, never elsewhere on disk.
			const inside = roots.some((root) => {
				if (!root) return false;
				const rel = relative(root, real);
				return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
			});
			if (!inside) return null;
			const info = await stat(real);
			if (!info.isFile() || info.size > QUOTE_FILE_BYTES) return null;
			const line = quoteLine(await readFile(real, "utf8"), quote);
			return line ? { in: "file", path: file, line } : null;
		} catch {
			return null;
		}
	}

	private called(runId: string, call: GatewayCall): void {
		const state = this.runs.get(runId);
		if (!state) return;
		const { name, at } = call;
		const seen = state.calls.get(name);
		state.calls.set(
			name,
			seen
				? { ...seen, count: seen.count + 1 }
				: { name, firstCalledAt: at, count: 1 },
		);
		for (const listener of [...state.listeners]) listener(call);
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
		if (state && !state.connected) {
			state.connected = true;
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
		const wildcard = ["0.0.0.0", "::"].includes(address.address);
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
					? listRunbooks(await this.runbookRepos(runId), { service })
					: [],
			read: async (runId, path, service) =>
				(await this.runbooksEnabled())
					? readRunbook(await this.runbookRepos(runId), path, service)
					: {
							ok: false,
							error: "Runbook discovery is turned off in PrismaLens.",
							disabled: true,
						},
		},
		searchInvestigations: (q) => this.searchInvestigations(q),
		incident: (q) => this.incident(q),
		findings: {
			recordEvidence: async (runId, input) => {
				const state = this.runs.get(runId);
				if (!state) return { error: NOT_LIVE };
				const file = input.path
					? await this.fileAnchor(runId, input.path, input.quote)
					: null;
				const r = state.ledger.addEvidence(
					input,
					file,
					new Date().toISOString(),
				);
				if (!("error" in r)) this.recorded(state, { type: "evidence", ...r });
				return r;
			},
			recordHypothesis: async (runId, input) => {
				const state = this.runs.get(runId);
				if (!state) return { error: NOT_LIVE };
				const r = state.ledger.addHypothesis(input, new Date().toISOString());
				if (!("error" in r)) this.recorded(state, { type: "hypothesis", ...r });
				return r;
			},
		},
	};

	/** The pre-run index of the run's runbooks: titles and paths only, never their text. */
	async runbookIndex(
		runId: string,
		signal?: AbortSignal,
	): Promise<RunbookIndex> {
		signal?.throwIfAborted();
		if (!(await this.runbooksEnabled()))
			return { entries: [], skipped: "runbook discovery is turned off" };
		signal?.throwIfAborted();
		const repos = (await this.runbookRepos(runId)).slice(0, INDEX_REPOS);
		return {
			entries: await listRunbooks(repos, {
				limit: INDEX_ENTRIES,
				...(signal ? { signal } : {}),
			}),
		};
	}

	/** On unless the operator switched it off. */
	async runbooksEnabled(): Promise<boolean> {
		const row = await this.prisma.setting.findUnique({
			where: { key: RUNBOOKS_SETTING },
			select: { value: true },
		});
		return row?.value !== "false";
	}

	/** The repos the run recorded, each at the commit it saw. */
	private async runbookRepos(runId: string): Promise<RunbookRepo[]> {
		const ws = await this.workspaceOf(runId);
		return (ws?.repos ?? [])
			.filter((r) => r.services.length)
			.map((r) => ({
				name: r.name,
				dir: r.dir,
				head: r.head,
				subPath: r.subPath,
				services: r.services,
			}));
	}

	private async workspaceOf(runId: string): Promise<RunWorkspace | null> {
		const row = await this.prisma.investigation.findUnique({
			where: { id: runId },
			select: { workspace: true },
		});
		if (!row?.workspace) return null;
		try {
			const ws = RunWorkspaceSchema.safeParse(JSON.parse(row.workspace));
			return ws.success ? ws.data : null;
		} catch {
			return null;
		}
	}

	private async incident(q: {
		runId: string;
		number?: number;
	}): Promise<IncidentView | null> {
		const select = {
			id: true,
			number: true,
			title: true,
			status: true,
			severity: true,
			description: true,
			triggeredAt: true,
			serviceId: true,
			service: { select: { name: true } },
			alerts: {
				select: {
					title: true,
					severity: true,
					labels: true,
					triggeredAt: true,
					serviceId: true,
				},
				orderBy: { triggeredAt: "asc" as const },
				take: 50,
			},
		};
		const row = q.number
			? await this.prisma.incident.findUnique({
					where: { number: q.number },
					select,
				})
			: (
					await this.prisma.investigation.findUnique({
						where: { id: q.runId },
						select: { incident: { select } },
					})
				)?.incident;
		if (!row) return null;
		// Every alert's service, not just the 50 shown, so a late one still brings its changes (#848).
		const alertServices = await this.prisma.alert.findMany({
			where: { incidentId: row.id, serviceId: { not: null } },
			select: { serviceId: true },
			distinct: ["serviceId"],
		});
		const serviceIds = [
			...new Set(
				[row.serviceId, ...alertServices.map((a) => a.serviceId)].filter(
					(id): id is string => !!id,
				),
			),
		];
		const changes = serviceIds.length
			? await this.prisma.changeEvent.findMany({
					where: {
						serviceId: { in: serviceIds },
						timestamp: {
							gte: new Date(row.triggeredAt.getTime() - CHANGES_BEFORE_MS),
							lte: new Date(),
						},
					},
					orderBy: { timestamp: "desc" },
					take: CHANGES_TAKE,
					select: {
						type: true,
						source: true,
						timestamp: true,
						description: true,
						metadata: true,
						service: { select: { name: true } },
					},
				})
			: [];
		return {
			number: row.number,
			title: row.title,
			status: row.status,
			severity: row.severity,
			service: row.service?.name ?? null,
			triggeredAt: row.triggeredAt.toISOString(),
			description: row.description,
			alerts: row.alerts.map((a) => ({
				title: a.title,
				severity: a.severity,
				labels: safeParseJsonObject(a.labels) ?? null,
				triggeredAt: a.triggeredAt.toISOString(),
			})),
			changes: changes.map((c) => {
				const meta = safeParseJsonObject(c.metadata) ?? {};
				const env = meta.environment ?? meta.env;
				return {
					type: c.type,
					source: c.source,
					timestamp: c.timestamp.toISOString(),
					service: c.service?.name ?? null,
					description: c.description,
					environment: typeof env === "string" ? env : null,
					version: typeof meta.version === "string" ? meta.version : null,
				};
			}),
		};
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
