// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One payload per kind of thread for the right panel (#1024 decision 1). Reads
 * only what PrismaLens stored and the run's own workspace; it never calls a git host.
 */
import { hostname } from "node:os";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import type {
	CanonicalEvent,
	RunWorkspace,
	ThreadContext,
} from "@prismalens/contracts";
import {
	AgentPlanSchema,
	CanonicalEventSchema,
	HelperPlaceSchema,
	IncidentStatusSchema,
	RecurrenceSchema,
	RunWorkspaceSchema,
	recordedFindings,
	SeveritySchema,
} from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import { workspaceGitState } from "../investigations/git-state.js";
import { shownWorkspace } from "../investigations/investigations.controller.js";
import { runScope, threadSubject } from "../investigations/run-scope.js";
import { readWorktreeChanges } from "../investigations/worktree-changes.js";
import { detectScripts } from "../repositories/project-scripts.js";
import { shownFullName } from "../repositories/serialize-repository.js";
import { RunWorkspacesService } from "../run-workspaces/run-workspaces.service.js";
import { PullRequestsService } from "./pull-requests.service.js";

/** Layouts whose kept worktree is the thread's own copy; a folder or in-place run has nothing to undo. */
const UNDO_LAYOUTS: ReadonlySet<string> = new Set([
	"single",
	"multi",
	"unmapped",
]);
/** The changes read gives up after this; the panel then shows no counts. */
const CHANGES_DEADLINE_MS = 5_000;

export function osName(
	platform: NodeJS.Platform = process.platform,
): ThreadContext["machine"]["os"] {
	return platform === "win32"
		? "windows"
		: platform === "darwin"
			? "macos"
			: platform === "linux"
				? "linux"
				: "other";
}

function parseJson(text: string | null): unknown {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

@Injectable()
export class ThreadContextService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly pullRequests: PullRequestsService,
		private readonly workspaces: RunWorkspacesService,
	) {}

	async context(id: string, isHost: boolean): Promise<ThreadContext> {
		const run = await this.prisma.investigation.findUnique({
			where: { id },
			include: {
				incident: true,
				repository: true,
				service: {
					include: {
						dependencies: {
							include: {
								dependency: {
									select: { id: true, name: true, displayName: true },
								},
							},
						},
					},
				},
			},
		});
		if (!run) throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
		const ws =
			RunWorkspaceSchema.safeParse(safeParseJsonObject(run.workspace)).data ??
			null;
		const base = {
			threadId: run.id,
			title: run.title,
			machine: { hostName: hostname(), os: osName(), isHost },
			agent: { harness: run.harness, model: run.model, effort: run.effort },
			workspace: await this.workspace(run.id, ws),
			git: await workspaceGitState(ws),
			lineage: await this.lineage(run),
			plan: AgentPlanSchema.safeParse(parseJson(run.agentPlan)).data ?? null,
			pullRequests: await this.pullRequests.stored(run.id),
		};
		const kind = threadSubject(run);
		if (kind === "incident" && run.incident) {
			const i = run.incident;
			return {
				kind,
				...base,
				incident: {
					id: i.id,
					number: i.number,
					title: i.title,
					severity: SeveritySchema.safeParse(i.severity).data ?? "medium",
					status: IncidentStatusSchema.safeParse(i.status).data ?? "triggered",
					alertCount: i.alertCount,
					impact: i.customerImpact,
				},
				suspects: recordedFindings(await this.events(run.id)).hypotheses.map(
					(h) => ({ id: h.id, statement: h.statement, status: h.status }),
				),
				report:
					run.status === "pending" || run.status === "running"
						? "running"
						: run.report
							? "ready"
							: run.status === "failed"
								? "failed"
								: "none",
			};
		}
		if (kind === "schedule" && run.scheduleId) {
			const s = await this.prisma.schedule.findUnique({
				where: { id: run.scheduleId },
			});
			const last = await this.prisma.investigation.findMany({
				where: { scheduleId: run.scheduleId },
				orderBy: { createdAt: "desc" },
				take: 5,
				select: { id: true, status: true, createdAt: true },
			});
			return {
				kind,
				...base,
				schedule: {
					id: run.scheduleId,
					name: s?.name ?? "Deleted schedule",
					recurrence:
						RecurrenceSchema.safeParse(parseJson(s?.recurrence ?? null)).data ??
						null,
					nextRunAt: s?.enabled ? (s.nextRunAt?.toISOString() ?? null) : null,
					lastRuns: last.map((r) => ({
						id: r.id,
						status: r.status,
						at: r.createdAt.toISOString(),
					})),
				},
			};
		}
		if (kind === "project" && run.repository) {
			const repo = run.repository;
			const folder =
				ws?.cwd ?? (repo.sourceKind === "folder" ? repo.url : null);
			return {
				kind,
				...base,
				project: { id: repo.id, name: shownFullName(repo) },
				scripts: folder ? await detectScripts(folder) : [],
			};
		}
		if (kind === "service" && run.service) {
			const s = run.service;
			return {
				kind,
				...base,
				service: {
					id: s.id,
					name: s.displayName || s.name,
					tier: s.tier,
					owner: s.team,
					dependencies: s.dependencies.map((d) => ({
						id: d.dependency.id,
						name: d.dependency.displayName || d.dependency.name,
					})),
				},
			};
		}
		return {
			kind: "none",
			...base,
			helperPlace: HelperPlaceSchema.safeParse(run.helperPlace).data ?? null,
		};
	}

	private async workspace(
		runId: string,
		raw: RunWorkspace | null,
	): Promise<ThreadContext["workspace"]> {
		const ws = shownWorkspace(raw);
		if (!ws) return null;
		// Counts only: no patch, so the diff's read and this one share a kept result.
		const changes = await readWorktreeChanges(raw, {
			deadlineMs: CHANGES_DEADLINE_MS,
			patch: "none",
		}).catch(() => null);
		const kept = UNDO_LAYOUTS.has(ws.layout)
			? await this.workspaces.listForRun(runId).catch(() => [])
			: [];
		return {
			layout: ws.layout,
			cwd: ws.cwd,
			repos: ws.repos.map((r, i) => {
				const c = changes?.repos[i];
				const ok = c?.state === "ok" ? c : null;
				return {
					name: r.name,
					branch: r.branch,
					head: r.head,
					additions: ok ? ok.additions : null,
					deletions: ok ? ok.deletions : null,
					ahead: ok?.sync?.ahead ?? null,
					behind: ok?.sync?.behind ?? null,
				};
			}),
			kept: kept.map((k) => ({ dir: k.dir })),
		};
	}

	/** The runs of the thread's unit: an incident's or a schedule's, else the thread alone. */
	private async lineage(run: {
		id: string;
		incidentId: string | null;
		scheduleId: string | null;
		repositoryId: string | null;
		serviceId: string | null;
	}): Promise<ThreadContext["lineage"]> {
		const rows = await this.prisma.investigation.findMany({
			where: runScope(run),
			orderBy: { createdAt: "asc" },
			take: 50,
			select: {
				id: true,
				kind: true,
				harness: true,
				model: true,
				status: true,
				lastTurnOutcome: true,
				endReason: true,
				createdAt: true,
			},
		});
		return rows.map((r) => ({
			id: r.id,
			kind: r.kind === "chat" ? "chat" : "investigation",
			harness: r.harness,
			model: r.model,
			status: r.status,
			outcome: r.lastTurnOutcome ?? r.endReason,
			at: r.createdAt.toISOString(),
		}));
	}

	private async events(id: string): Promise<CanonicalEvent[]> {
		const rows = await this.prisma.investigationEvent.findMany({
			where: { investigationId: id, event: { contains: '"finding_recorded"' } },
			orderBy: { seq: "asc" },
			select: { event: true },
		});
		const out: CanonicalEvent[] = [];
		for (const r of rows) {
			const parsed = CanonicalEventSchema.safeParse(parseJson(r.event));
			if (parsed.success) out.push(parsed.data);
		}
		return out;
	}
}
