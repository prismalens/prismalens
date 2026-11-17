// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One payload per kind of thread for the right panel (#1024 decision 1). Reads
 * only what PrismaLens stored and the run's own workspace; it never calls a git host.
 */
import { hostname } from "node:os";
import { join } from "node:path";
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
	RunUsageSchema,
	RunWorkspaceSchema,
	recordedFindings,
	SessionOpeningSchema,
	SeveritySchema,
} from "@prismalens/contracts";
import {
	GIT_PROBE_TIMEOUT_MS,
	spawnGit,
} from "../../core/harness/git-spawn.js";
import { projectSlug } from "../../core/harness/run-worktree.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import { workspaceGitState } from "../investigations/git-state.js";
import { shownWorkspace } from "../investigations/investigations.controller.js";
import { gitDirOf } from "../investigations/remote-heads.js";
import { runScope, threadSubject } from "../investigations/run-scope.js";
import {
	baseEnv,
	readWorktreeChanges,
} from "../investigations/worktree-changes.js";
import {
	detectScripts,
	storedScripts,
} from "../repositories/project-scripts.js";
import { shownFullName } from "../repositories/serialize-repository.js";
import { RunWorkspacesService } from "../run-workspaces/run-workspaces.service.js";
import { addTurn, emptyBucket, readTurnUsage } from "../usage/usage.js";
import { remoteOf } from "./pr-url.js";
import { PullRequestsService } from "./pull-requests.service.js";

/** Layouts whose kept worktree is the thread's own copy; a folder or in-place run has nothing to undo. */
const UNDO_LAYOUTS: ReadonlySet<string> = new Set([
	"single",
	"multi",
	"unmapped",
]);
/** The changes read gives up after this; the panel then shows no counts. */
const CHANGES_DEADLINE_MS = 5_000;
/** Layouts whose worktree is the thread's own, made from the project's folder or a clone. */
const OWN_LAYOUTS: ReadonlySet<string> = new Set(["single", "multi"]);

const probe = async (dir: string, args: string[]): Promise<string | null> => {
	try {
		const { stdout } = await spawnGit(
			["-C", dir, "-c", "core.fsmonitor=false", ...args],
			{ timeoutMs: GIT_PROBE_TIMEOUT_MS, env: baseEnv() },
		);
		return stdout.trim();
	} catch {
		return null;
	}
};

/** PR A's strict ref charset (#1176 §4 safeRef): nothing a shell or git reads specially. */
const SAFE_REF =
	/^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

/**
 * The branch a detached worktree is offered: the thread's title as a short slug and six
 * characters of its id, at most 50 long, checked by git before it goes into a command.
 */
export async function newBranchName(
	dir: string,
	runId: string,
	title: string | null,
): Promise<string | null> {
	const id = runId
		.replace(/[^a-z0-9]/gi, "")
		.slice(0, 6)
		.toLowerCase();
	const slug = projectSlug(title ?? "")
		.slice(0, 32)
		.replace(/-+$/, "");
	const name = `prismalens/${slug || "thread"}-${id}`;
	if (!SAFE_REF.test(name) || name.endsWith(".lock")) return null;
	const ok = await probe(dir, ["check-ref-format", "--branch", name]);
	return ok === name ? name : null;
}

/**
 * A worktree's live tip, whether it is on no branch, and whether a branch made there can be
 * pushed: a worktree (not a clone, whose origin is a mirror) with one push URL, the project's (#1176 F2).
 */
export async function worktreeTip(
	dir: string,
	own: boolean,
): Promise<{ tip?: string; detached?: boolean; pushable?: boolean }> {
	const [tip, ref] = await Promise.all([
		probe(dir, ["rev-parse", "--verify", "-q", "HEAD"]),
		probe(dir, ["symbolic-ref", "-q", "HEAD"]),
	]);
	if (!tip) return {};
	const out = { tip, detached: !ref };
	if (!own) return out;
	const gitDir = await gitDirOf(dir);
	if (!gitDir || gitDir === join(dir, ".git"))
		return { ...out, pushable: false };
	const [push, fetch] = await Promise.all([
		probe(dir, ["remote", "get-url", "--push", "--all", "origin"]),
		probe(dir, ["remote", "get-url", "origin"]),
	]);
	const urls = push?.split(/\r?\n/).filter(Boolean) ?? [];
	const a = urls.length === 1 && urls[0] ? remoteOf("", urls[0]) : null;
	const b = fetch ? remoteOf("", fetch) : null;
	return {
		...out,
		pushable: !!a && !!b && a.host === b.host && a.repo === b.repo,
	};
}

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
		const pullRequests = await this.pullRequests.stored(run.id);
		const base = {
			threadId: run.id,
			title: run.title,
			// The controller passes isOwner(request) as isHost: the host is the owner's computer.
			machine: { hostName: hostname(), os: osName(), isHost, isOwner: isHost },
			agent: { harness: run.harness, model: run.model, effort: run.effort },
			workspace: await this.workspace(run.id, ws, run.title),
			git: await workspaceGitState(ws),
			lineage: await this.lineage(run),
			plan: AgentPlanSchema.safeParse(parseJson(run.agentPlan)).data ?? null,
			pullRequests,
			usage: await this.usage(run.id, run.usage),
			session: await this.session(run.id),
			ownPrIds: await this.pullRequests
				.ownPrIds(run.id, pullRequests)
				.catch(() => []),
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
				scripts: [
					...storedScripts(repo.metadata),
					...(folder ? await detectScripts(folder) : []),
				],
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
		title: string | null,
	): Promise<ThreadContext["workspace"]> {
		const ws = shownWorkspace(raw);
		if (!ws || !raw) return null;
		const own = OWN_LAYOUTS.has(ws.layout);
		const suggestedBranch =
			own && raw.repos[0]
				? await newBranchName(raw.repos[0].dir, runId, title)
				: null;
		const tips = await Promise.all(
			raw.repos.map((r) =>
				ws.layout === "folder" || ws.layout === "unmapped"
					? {}
					: worktreeTip(r.dir, own),
			),
		);
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
					...tips[i],
				};
			}),
			kept: kept.map((k) => ({ dir: k.dir })),
			...(suggestedBranch ? { suggestedBranch } : {}),
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

	/** From stored rows only: the last usage_update and every turn_usage (#1176 D10). */
	private async usage(
		id: string,
		raw: string | null,
	): Promise<ThreadContext["usage"]> {
		const rows = await this.prisma.investigationEvent.findMany({
			where: {
				investigationId: id,
				event: { contains: '"kind":"turn_usage"' },
			},
			select: { event: true },
		});
		const tokens = emptyBucket().tokens;
		const costs = new Map<string, number>();
		let turns = 0;
		let unpricedTurns = 0;
		for (const r of rows) {
			const usage = readTurnUsage(r.event);
			if (!usage) continue;
			const bucket = { ...emptyBucket(), tokens };
			addTurn(bucket, usage);
			turns += 1;
			if (usage.cost)
				costs.set(
					usage.cost.currency,
					(costs.get(usage.cost.currency) ?? 0) + usage.cost.amount,
				);
			else unpricedTurns += 1;
		}
		return {
			context: RunUsageSchema.safeParse(parseJson(raw)).data ?? null,
			turns,
			tokens,
			costs: [...costs].slice(0, 10).map(([currency, amount]) => ({
				amount,
				currency,
			})),
			unpricedTurns,
		};
	}

	/** The newest `session_opened`, by seq; null when the thread recorded none (#1176 D11). */
	private async session(id: string): Promise<ThreadContext["session"]> {
		const row = await this.prisma.investigationEvent.findFirst({
			where: {
				investigationId: id,
				event: { contains: '"kind":"session_opened"' },
			},
			orderBy: { seq: "desc" },
			select: { event: true },
		});
		return row
			? (SessionOpeningSchema.safeParse(parseJson(row.event)).data ?? null)
			: null;
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
