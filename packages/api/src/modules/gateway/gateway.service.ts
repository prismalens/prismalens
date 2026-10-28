// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFile, realpath, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Injectable, Optional } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import { INVESTIGATION_DEFAULTS } from "@prismalens/config/investigation";
import {
	type Artifact,
	FixVerdictSchema,
	InvestigationReportSchema,
	isWorkflowLive,
	type QuoteAnchor,
	type RecordedFinding,
	RunUsageSchema,
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
	autoAllowed,
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
import { attachmentsDir } from "../investigations/attachments.service.js";
import { bearerOf, RunTokens } from "./run-tokens.js";
import {
	listRunbooks,
	type RunbookEntry,
	type RunbookRepo,
	readRunbook,
} from "./runbooks.js";
import {
	type AttachmentItem,
	type ChangeItem,
	type GatewayToolData,
	gatewayTools,
	type IncidentView,
	type InvestigationsQuery,
	type PastFix,
	type PastInvestigation,
	type RunStatusView,
	type ServiceView,
	type SimilarIncident,
	type ThreadSummary,
	type ThreadView,
	type TimelineItem,
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
/** What `thread_read` returns of an unfinished thread, and the rows it looks through for it (#848). */
const THREAD_STEPS = 20;
const THREAD_STEP_ROWS = 60;
const STEP_CHARS = 1_000;
const TIMELINE_TEXT_CHARS = 500;
const SERVICE_LINKS = 50;
/** Attachments one listing returns, and the fix-check entries one fixes_list reads (#848). */
const ATTACHMENTS_LISTED = 100;
const FIX_CHECK_ROWS = 500;

/** `raw` as JSON that satisfies `schema`; null when it is absent or not. */
function parseWith<T>(
	schema: {
		safeParse: (v: unknown) => { success: true; data: T } | { success: false };
	},
	raw: string | null | undefined,
): T | null {
	if (!raw) return null;
	try {
		const r = schema.safeParse(JSON.parse(raw));
		return r.success ? r.data : null;
	} catch {
		return null;
	}
}

/** The environment and version a change event's metadata names. */
function changeFacts(metadata: string | null): {
	environment: string | null;
	version: string | null;
} {
	const meta = safeParseJsonObject(metadata) ?? {};
	const env = meta.environment ?? meta.env;
	return {
		environment: typeof env === "string" ? env : null,
		version: typeof meta.version === "string" ? meta.version : null,
	};
}

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
	/** HTML pages the agent published, and who hears the next one (#871). */
	artifacts: Artifact[];
	published: Set<(a: Artifact) => void>;
	/** False once the engine stopped hearing the run: a record would reach neither the stream nor the report. */
	recording: boolean;
	/** What this run lists and may execute (#848). */
	view: RunView;
}

const NO_TOOLS: RunView = { direct: [], deferred: [] };

/** The largest file a recorded quote is looked up in. */
const QUOTE_FILE_BYTES = 2_000_000;
/** Pages one run may publish (#871). */
const ARTIFACTS_PER_RUN = 20;
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
			artifacts: [],
			published: new Set(),
			recording: true,
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
			autoAllow: autoAllowed(state.view),
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
			closeRecording: () => {
				state.recording = false;
			},
			artifacts: () => [...state.artifacts],
			onArtifact: (listener) => {
				state.published.add(listener);
				return () => state.published.delete(listener);
			},
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
		state?.published.clear();
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
		threads: {
			list: (q) => this.listThreads(q),
			read: (runId, threadId) => this.readThread(runId, threadId),
		},
		incidentRecord: {
			timeline: (runId, limit) => this.timeline(runId, limit),
			scope: (runId) => this.changeScope(runId),
			changes: (q) => this.changesIn(q),
		},
		service: (name) => this.serviceView(name),
		runStatus: (runId) => this.runStatus(runId),
		attachments: {
			list: (runId) => this.attachmentsOf(runId),
			read: (runId, id) => this.attachmentOf(runId, id),
		},
		history: {
			similar: (runId, limit) => this.similarTo(runId, limit),
			fixes: (runId, limit) => this.pastFixes(runId, limit),
		},
		artifacts: {
			publish: async (runId, page) => {
				const state = this.runs.get(runId);
				if (!state?.recording) return { error: NOT_LIVE, ended: true };
				if (state.artifacts.length >= ARTIFACTS_PER_RUN)
					return {
						error: `This run already holds ${ARTIFACTS_PER_RUN} pages`,
					};
				const artifact: Artifact = {
					id: `a${state.artifacts.length + 1}`,
					...page,
					at: new Date().toISOString(),
				};
				state.artifacts.push(artifact);
				for (const listener of [...state.published]) listener(artifact);
				return { id: artifact.id };
			},
		},
		findings: {
			recordEvidence: async (runId, input) => {
				const state = this.runs.get(runId);
				if (!state?.recording) return { error: NOT_LIVE };
				const file = input.path
					? await this.fileAnchor(runId, input.path, input.quote)
					: null;
				// The run can end while the file is read; nothing is kept for an ended run.
				if (this.runs.get(runId) !== state || !state.recording)
					return { error: NOT_LIVE };
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
				if (!state?.recording) return { error: NOT_LIVE };
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
		return parseWith(RunWorkspaceSchema, row?.workspace);
	}

	/** The run's incident; null when the run has none. */
	private async runIncident(runId: string) {
		const row = await this.prisma.investigation.findUnique({
			where: { id: runId },
			select: {
				incident: {
					select: {
						id: true,
						number: true,
						triggeredAt: true,
						serviceId: true,
					},
				},
			},
		});
		return row?.incident ?? null;
	}

	/** The incident's own service and every alert's, not just the alerts shown (#848). */
	private async serviceIdsOf(
		incidentId: string,
		serviceId: string | null,
	): Promise<string[]> {
		const alertServices = await this.prisma.alert.findMany({
			where: { incidentId, serviceId: { not: null } },
			select: { serviceId: true },
			distinct: ["serviceId"],
		});
		return [
			...new Set(
				[serviceId, ...alertServices.map((a) => a.serviceId)].filter(
					(id): id is string => !!id,
				),
			),
		];
	}

	private async listThreads(q: {
		runId: string;
		service?: string;
		limit: number;
	}): Promise<{ threads: ThreadSummary[] } | { error: string }> {
		let where: Record<string, unknown>;
		if (q.service) {
			const service = await this.prisma.service.findUnique({
				where: { name: q.service },
				select: { id: true },
			});
			if (!service)
				return { error: `PrismaLens has no service named "${q.service}".` };
			where = { id: { not: q.runId }, incident: { serviceId: service.id } };
		} else {
			const incident = await this.runIncident(q.runId);
			if (!incident) return { error: "This run has no incident recorded." };
			where = { id: { not: q.runId }, incidentId: incident.id };
		}
		const rows = await this.prisma.investigation.findMany({
			where,
			orderBy: { createdAt: "desc" },
			take: q.limit,
			select: {
				id: true,
				kind: true,
				status: true,
				startedAt: true,
				completedAt: true,
				harness: true,
				model: true,
				summary: true,
			},
		});
		return {
			threads: rows.map((r) => ({
				id: r.id,
				kind: r.kind,
				status: r.status,
				startedAt: r.startedAt?.toISOString() ?? null,
				finishedAt: r.completedAt?.toISOString() ?? null,
				agent: r.harness,
				model: r.model,
				...(r.status === "completed" && r.summary
					? { summary: r.summary }
					: {}),
			})),
		};
	}

	private async readThread(
		runId: string,
		threadId: string,
	): Promise<ThreadView | null> {
		const own = await this.runIncident(runId);
		if (!own) return null;
		const row = await this.prisma.investigation.findUnique({
			where: { id: threadId },
			select: {
				id: true,
				kind: true,
				status: true,
				summary: true,
				rootCause: true,
				report: true,
				error: true,
				incident: { select: { id: true, serviceId: true } },
			},
		});
		if (!row) return null;
		// Readable on this run's incident, or on another incident of one of its services.
		if (row.incident.id !== own.id) {
			const mine = await this.serviceIdsOf(own.id, own.serviceId);
			if (!row.incident.serviceId || !mine.includes(row.incident.serviceId))
				return null;
		}
		const head = { id: row.id, kind: row.kind, status: row.status };
		if (row.status === "completed") {
			const report = parseWith(InvestigationReportSchema, row.report);
			return {
				...head,
				report: {
					summary: report?.summary ?? row.summary,
					rootCause: report?.rootCause ?? row.rootCause,
					hypotheses: (report?.hypotheses ?? []).map((h) => ({
						statement: h.statement,
						status: h.status,
					})),
					nextSteps: (report?.nextSteps ?? []).map((n) => ({
						title: n.title,
						detail: n.detail,
					})),
					culprit: report?.culprit ?? null,
				},
				steps: [],
				error: null,
			};
		}
		// A live thread gives its status only: another run's unfinished reasoning is not evidence.
		if (isWorkflowLive(row.status))
			return { ...head, report: null, steps: [], error: null };
		const events = await this.prisma.investigationEvent.findMany({
			where: {
				investigationId: row.id,
				event: { contains: '"kind":"agent_step"' },
			},
			orderBy: { seq: "desc" },
			take: THREAD_STEP_ROWS,
			select: { event: true },
		});
		const steps = events
			.flatMap((e) => {
				const ev = safeParseJsonObject(e.event);
				return ev?.kind === "agent_step" &&
					typeof ev.text === "string" &&
					ev.text.trim()
					? [ev.text.slice(0, STEP_CHARS)]
					: [];
			})
			.slice(0, THREAD_STEPS)
			.reverse();
		return { ...head, report: null, steps, error: row.error };
	}

	private async timeline(
		runId: string,
		limit: number,
	): Promise<{
		incident: number;
		total: number;
		entries: TimelineItem[];
	} | null> {
		const incident = await this.runIncident(runId);
		if (!incident) return null;
		const where = { incidentId: incident.id };
		const [rows, total] = await Promise.all([
			this.prisma.timelineEntry.findMany({
				where,
				orderBy: { occurredAt: "desc" },
				take: limit,
				select: {
					type: true,
					title: true,
					description: true,
					source: true,
					occurredAt: true,
				},
			}),
			this.prisma.timelineEntry.count({ where }),
		]);
		return {
			incident: incident.number,
			total,
			entries: [...rows].reverse().map((r) => ({
				type: r.type,
				source:
					r.source === "user"
						? "operator"
						: r.source === "ai_worker"
							? "agent"
							: "system",
				text: (r.description ? `${r.title}: ${r.description}` : r.title).slice(
					0,
					TIMELINE_TEXT_CHARS,
				),
				at: r.occurredAt.toISOString(),
			})),
		};
	}

	private async changeScope(runId: string): Promise<{
		number: number;
		triggeredAt: string;
		services: string[];
	} | null> {
		const incident = await this.runIncident(runId);
		if (!incident) return null;
		const ids = await this.serviceIdsOf(incident.id, incident.serviceId);
		const services = ids.length
			? await this.prisma.service.findMany({
					where: { id: { in: ids } },
					select: { name: true },
					orderBy: { name: "asc" },
				})
			: [];
		return {
			number: incident.number,
			triggeredAt: incident.triggeredAt.toISOString(),
			services: services.map((s) => s.name),
		};
	}

	private async changesIn(q: {
		services: string[];
		from: string;
		to: string;
		limit: number;
	}): Promise<{ unknown: string[]; changes: ChangeItem[] }> {
		const found = await this.prisma.service.findMany({
			where: { name: { in: q.services } },
			select: { id: true, name: true },
		});
		const unknown = q.services.filter((n) => !found.some((s) => s.name === n));
		if (unknown.length) return { unknown, changes: [] };
		const rows = await this.prisma.changeEvent.findMany({
			where: {
				serviceId: { in: found.map((s) => s.id) },
				timestamp: { gte: new Date(q.from), lte: new Date(q.to) },
			},
			orderBy: { timestamp: "desc" },
			take: q.limit,
			select: {
				type: true,
				source: true,
				timestamp: true,
				description: true,
				metadata: true,
				service: { select: { name: true } },
			},
		});
		return {
			unknown: [],
			changes: rows.map((c) => ({
				type: c.type,
				source: c.source,
				at: c.timestamp.toISOString(),
				service: c.service?.name ?? null,
				description: c.description,
				...changeFacts(c.metadata),
			})),
		};
	}

	private async serviceView(name: string): Promise<ServiceView | null> {
		const s = await this.prisma.service.findUnique({
			where: { name },
			select: {
				name: true,
				displayName: true,
				type: true,
				tier: true,
				team: true,
				slackChannel: true,
				tags: true,
				repositories: {
					select: {
						subPath: true,
						repository: { select: { fullName: true, defaultBranch: true } },
					},
					take: SERVICE_LINKS,
				},
				dependencies: {
					select: {
						criticality: true,
						dependency: { select: { name: true } },
					},
					take: SERVICE_LINKS,
				},
				dependents: {
					select: {
						criticality: true,
						dependent: { select: { name: true } },
					},
					take: SERVICE_LINKS,
				},
			},
		});
		if (!s) return null;
		let tags: string[] = [];
		try {
			const parsed: unknown = s.tags ? JSON.parse(s.tags) : [];
			if (Array.isArray(parsed))
				tags = parsed.filter((t): t is string => typeof t === "string");
		} catch {
			// A tags column that is not JSON reads as no tags.
		}
		return {
			name: s.name,
			displayName: s.displayName,
			type: s.type,
			tier: s.tier,
			team: s.team,
			slackChannel: s.slackChannel,
			tags,
			repos: s.repositories.map((r) => ({
				name: r.repository.fullName,
				subPath: r.subPath,
				branch: r.repository.defaultBranch,
			})),
			dependsOn: s.dependencies.map((d) => ({
				name: d.dependency.name,
				criticality: d.criticality,
			})),
			dependedOnBy: s.dependents.map((d) => ({
				name: d.dependent.name,
				criticality: d.criticality,
			})),
		};
	}

	private async attachmentsOf(
		runId: string,
	): Promise<{ incident: number; attachments: AttachmentItem[] } | null> {
		const incident = await this.runIncident(runId);
		if (!incident) return null;
		const rows = await this.prisma.attachment.findMany({
			where: { incidentId: incident.id },
			orderBy: { createdAt: "desc" },
			take: ATTACHMENTS_LISTED,
			select: {
				id: true,
				name: true,
				mimeType: true,
				size: true,
				createdAt: true,
			},
		});
		return {
			incident: incident.number,
			attachments: rows.map((r) => ({
				id: r.id,
				name: r.name,
				mimeType: r.mimeType,
				size: r.size,
				at: r.createdAt.toISOString(),
			})),
		};
	}

	private async attachmentOf(runId: string, id: string) {
		const incident = await this.runIncident(runId);
		if (!incident) return null;
		const row = await this.prisma.attachment.findFirst({
			where: { id, incidentId: incident.id },
			select: { id: true, name: true, mimeType: true, size: true },
		});
		if (!row) return null;
		return {
			name: row.name,
			mimeType: row.mimeType,
			size: row.size,
			// The bytes sit under the attachments directory by row id, as AttachmentsService writes them.
			text: () =>
				readFile(join(attachmentsDir(), row.id), "utf8").catch(() => null),
		};
	}

	private async similarTo(
		runId: string,
		limit: number,
	): Promise<{ incident: number; similar: SimilarIncident[] } | null> {
		const incident = await this.runIncident(runId);
		if (!incident) return null;
		const scored = await this.prisma.incidentSimilarity.findMany({
			where: { incidentId: incident.id },
			orderBy: [{ similarityScore: "desc" }, { calculatedAt: "desc" }],
			take: limit,
			select: {
				similarIncidentId: true,
				similarityScore: true,
				matchFactors: true,
			},
		});
		const rows = scored.length
			? await this.prisma.incident.findMany({
					where: { id: { in: scored.map((s) => s.similarIncidentId) } },
					select: {
						id: true,
						number: true,
						title: true,
						status: true,
						resolvedAt: true,
						actualCause: true,
						actualCauseCategory: true,
						service: { select: { name: true } },
					},
				})
			: [];
		const byId = new Map(rows.map((r) => [r.id, r]));
		return {
			incident: incident.number,
			similar: scored.flatMap((s) => {
				const r = byId.get(s.similarIncidentId);
				if (!r) return [];
				const matched = safeParseJsonObject(s.matchFactors)?.matchedOn;
				return [
					{
						number: r.number,
						title: r.title,
						service: r.service?.name ?? null,
						status: r.status,
						resolvedAt: r.resolvedAt?.toISOString() ?? null,
						actualCause: r.actualCause
							? { cause: r.actualCause, category: r.actualCauseCategory }
							: null,
						similarityScore: s.similarityScore,
						matchedOn: Array.isArray(matched)
							? matched.filter((m): m is string => typeof m === "string")
							: [],
					},
				];
			}),
		};
	}

	private async pastFixes(
		runId: string,
		limit: number,
	): Promise<{ incident: number; fixes: PastFix[] } | null> {
		const incident = await this.runIncident(runId);
		if (!incident) return null;
		const serviceIds = await this.serviceIdsOf(incident.id, incident.serviceId);
		const recs = serviceIds.length
			? await this.prisma.recommendation.findMany({
					where: {
						investigation: {
							id: { not: runId },
							incident: { serviceId: { in: serviceIds } },
						},
					},
					orderBy: { createdAt: "desc" },
					take: limit,
					select: {
						id: true,
						investigationId: true,
						title: true,
						description: true,
						priority: true,
						category: true,
						status: true,
						implementedAt: true,
						investigation: {
							select: { incident: { select: { id: true, number: true } } },
						},
					},
				})
			: [];
		// A check is on the timeline of the incident whose run it was, in FixesService's own metadata.
		const checks = recs.length
			? await this.prisma.timelineEntry.findMany({
					where: {
						incidentId: {
							in: [...new Set(recs.map((r) => r.investigation.incident.id))],
						},
						type: "custom",
						metadata: { contains: '"event":"fix_check"' },
					},
					orderBy: { occurredAt: "desc" },
					take: FIX_CHECK_ROWS,
					select: { metadata: true, occurredAt: true },
				})
			: [];
		const checked = checks.flatMap((c) => {
			const m = safeParseJsonObject(c.metadata);
			const verdict = FixVerdictSchema.safeParse(m?.verdict);
			return typeof m?.stepId === "string" && verdict.success
				? [{ stepId: m.stepId, verdict: verdict.data, at: c.occurredAt }]
				: [];
		});
		return {
			incident: incident.number,
			fixes: recs.map((r) => {
				// Newest first, so the first check since it was applied is the latest.
				const last = checked.find(
					(c) =>
						c.stepId === r.id && (!r.implementedAt || c.at >= r.implementedAt),
				);
				return {
					id: r.id,
					title: r.title,
					detail: r.description,
					incident: r.investigation.incident.number,
					investigationId: r.investigationId,
					status: r.status === "completed" ? "applied" : r.status,
					priority: r.priority,
					category: r.category,
					appliedAt: r.implementedAt?.toISOString() ?? null,
					lastCheck: last
						? { verdict: last.verdict, at: last.at.toISOString() }
						: null,
				};
			}),
		};
	}

	private async runStatus(runId: string): Promise<RunStatusView | null> {
		const row = await this.prisma.investigation.findUnique({
			where: { id: runId },
			select: {
				status: true,
				startedAt: true,
				usage: true,
				accessLevel: true,
				workspace: true,
			},
		});
		if (!row) return null;
		const usage = parseWith(RunUsageSchema, row.usage);
		const ws = parseWith(RunWorkspaceSchema, row.workspace);
		return {
			status: row.status,
			usage: usage
				? {
						used: usage.used,
						size: usage.size,
						...(usage.cost ? { cost: usage.cost } : {}),
					}
				: null,
			// The wall clock runs from the status turning running; a run without a start has no clock to read.
			secondsLeft: row.startedAt
				? Math.max(
						0,
						Math.round(
							(row.startedAt.getTime() +
								INVESTIGATION_DEFAULTS.harnessWallClockMs -
								Date.now()) /
								1000,
						),
					)
				: null,
			accessLevel: row.accessLevel,
			repos: (ws?.repos ?? []).map((r) => ({
				name: r.name,
				subPath: r.subPath,
				branch: r.branch,
				commit: r.head,
				services: r.services,
			})),
		};
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
		const serviceIds = await this.serviceIdsOf(row.id, row.serviceId);
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
			changes: changes.map((c) => ({
				type: c.type,
				source: c.source,
				timestamp: c.timestamp.toISOString(),
				service: c.service?.name ?? null,
				description: c.description,
				...changeFacts(c.metadata),
			})),
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
