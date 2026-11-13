// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, Optional } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import type {
	AutoPause,
	Investigation as InvestigationView,
	JobAttachment,
	RunChoice,
	SettledState,
	SettleResponse,
	StartThreadInput,
	ThreadFeed,
	ThreadFeedQuery,
	ThreadRow,
	ThreadSettings,
	ThreadStatusInfo,
	WorkIn,
} from "@prismalens/contracts";
import {
	AccessLevelSchema,
	type AskKind,
	AutoPauseSchema,
	type CanonicalEvent,
	CanonicalEventSchema,
	DEFAULT_SETTLE_AFTER_DAYS,
	FailureModeSchema,
	IncidentStatusSchema,
	inlinePlain,
	isWorkflowTerminal,
	pendingAsks,
	placeAttachments,
	SETTLE_UNDO_MS,
	SeveritySchema,
	ThreadSettingsSchema,
	WorkInSchema,
} from "@prismalens/contracts";
import type { Investigation, Prisma } from "@prismalens/database";
import { VIEW_ONLY } from "../../core/auth/owner.js";
import { HarnessService } from "../../core/harness/harness.service.js";
import { requireReadyHarness } from "../../core/harness/ready-harness.js";
import { liveChanges } from "../../core/live/live-changes.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	busyReason,
	CheckoutUnreadable,
	checkoutBusy,
	checkoutRoot,
	takeLease,
} from "../../infrastructure/dispatch/checkout-lease.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import {
	FOLDER_BUSY,
	folderBusy,
} from "../../infrastructure/dispatch/folder-lock.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import { hasWildcard, likePattern } from "../../shared/utils/literal-like.js";
import { consumeAfterSend, DraftsService } from "../composer/drafts.service.js";
import { incidentSearch, stepText } from "../incidents/incidents.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { AttachmentsService } from "../investigations/attachments.service.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
import { threadSubject } from "../investigations/run-scope.js";
import { ReferencesService } from "../references/references.service.js";
import { shownFullName } from "../repositories/serialize-repository.js";
import { threadLink } from "../thread-tree/tree-text.js";
import { nextTryOf } from "../wakes/session.js";
import { PullRequestsService } from "./pull-requests.service.js";
import { isSettled } from "./settled.js";
import { SIDE_QUESTION } from "./side-question.js";
import { ThreadLifecycleService } from "./thread-lifecycle.service.js";
import { isUnseen, threadSection, unitsOf } from "./thread-sections.js";
import { ThreadStatusService } from "./thread-status.service.js";
import { renameThread } from "./thread-titles.js";

const SETTINGS_KEY = "threads.list";
const NOT_A_CHECKOUT =
	"Only a project on a local git repository can work in its checkout.";
/** The newest threads the list ranks; older ones stay reachable by search. */
const FEED_CAP = 500;

const FEED_INCLUDE = {
	incident: {
		select: {
			id: true,
			number: true,
			title: true,
			severity: true,
			status: true,
			closedAt: true,
			service: { select: { name: true, displayName: true } },
		},
	},
	repository: { select: { sourceKind: true, url: true, fullName: true } },
	service: { select: { name: true, displayName: true } },
} satisfies Prisma.InvestigationInclude;

type FeedRow = Prisma.InvestigationGetPayload<{
	include: typeof FEED_INCLUDE;
}>;

/** Who started a thread (#1101 cat 10): its starter, its chain, and a label (`fork`) or none. */
export interface TreePlacement {
	parentId: string;
	/** Where the start chain began; null for a person's fork or side question. */
	rootId: string | null;
	role: string | null;
	depth: number;
	title: string;
	/** The pending action that started it: a retried start finds this thread again. */
	actionId: string;
	/** The commit or ref each repo is checked out at; absent takes the default branch. */
	at?: (repo: { url: string }) => string | undefined;
}

/** The trigger reason that keys a child to the action that started it. */
export const actionReason = (actionId: string) => `action:${actionId}`;

/** The chips a request named; each field it left out falls back to Settings. */
function runChoice({
	harness,
	model,
	effort,
	agentMode,
}: RunChoice): RunChoice {
	return {
		...(harness ? { harness } : {}),
		...(model !== undefined ? { model } : {}),
		...(effort !== undefined ? { effort } : {}),
		...(agentMode ? { agentMode } : {}),
	};
}

/** A thread list row; agent text such as the title is shown as plain text only. */
/** The first repo's branch in a stored workspace; null when it names none or will not parse. */
export function branchOf(workspace: string | null | undefined): string | null {
	if (!workspace) return null;
	try {
		const ws = JSON.parse(workspace) as { repos?: { branch?: unknown }[] };
		const b = ws.repos?.find((r) => typeof r.branch === "string")?.branch;
		return typeof b === "string" && b ? b : null;
	} catch {
		return null;
	}
}

export function threadView(row: Investigation): InvestigationView {
	return {
		id: row.id,
		incidentId: row.incidentId,
		serviceId: row.serviceId,
		scheduleId: row.scheduleId,
		repositoryId: row.repositoryId,
		subject: threadSubject(row),
		status: row.status as InvestigationView["status"],
		kind: row.kind === "chat" ? "chat" : "investigation",
		title: row.title,
		accessLevel: AccessLevelSchema.safeParse(row.accessLevel).data ?? null,
		harness: row.harness,
		model: row.model,
		effort: row.effort,
		startedAt: row.startedAt?.toISOString() ?? null,
		completedAt: row.completedAt?.toISOString() ?? null,
		summary: null,
		rootCause: null,
		rootCauseCategory: null,
		error: row.error,
		awaitingApprovalAt: row.awaitingApprovalAt?.toISOString() ?? null,
		origin: row.origin,
		schemaVersion: row.schemaVersion,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/**
 * Project, service and no-subject threads (#1020). Each is its own admission unit, so
 * two never collide; the agent checks are the incident chat's.
 */
/** A side question stays out of every list until Keep as thread makes it a fork. */
const LISTED = { OR: [{ role: null }, { role: { not: SIDE_QUESTION } }] };

@Injectable()
export class ThreadsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly investigations: InvestigationsService,
		private readonly dispatch: DispatchService,
		private readonly harness: HarnessService,
		private readonly attachments: AttachmentsService,
		private readonly integrations: IntegrationsService,
		private readonly drafts: DraftsService,
		private readonly references: ReferencesService,
		private readonly pullRequests: PullRequestsService,
		private readonly lifecycle: ThreadLifecycleService,
		@Optional() private readonly status?: ThreadStatusService,
	) {}

	async start(
		input: StartThreadInput,
		tree?: TreePlacement,
	): Promise<{
		investigationId: string;
		jobId: string | null;
		queued: boolean;
	}> {
		const subject = input.subject;
		const ids = {
			repositoryId: subject.kind === "project" ? subject.repositoryId : null,
			serviceId: subject.kind === "service" ? subject.serviceId : null,
		};
		const helperPlace = subject.kind === "none" ? input.place : undefined;
		let checkout: string | null = null;
		if (ids.repositoryId) {
			const found = await this.prisma.repository.findUnique({
				where: { id: ids.repositoryId },
				select: {
					id: true,
					sourceKind: true,
					plain: true,
					url: true,
					workIn: true,
				},
			});
			if (!found)
				throw new ORPCError("NOT_FOUND", { message: "Project not found" });
			if (!tree) checkout = await this.checkoutFor(found, input.workIn);
		} else if (input.workIn === "checkout")
			throw new ORPCError("BAD_REQUEST", { message: NOT_A_CHECKOUT });
		if (ids.serviceId) {
			const found = await this.prisma.service.findUnique({
				where: { id: ids.serviceId },
				select: { id: true },
			});
			if (!found)
				throw new ORPCError("NOT_FOUND", { message: "Service not found" });
		}
		const files = input.attachments ?? [];
		if (files.length && !input.draftKey)
			throw new ORPCError("BAD_REQUEST", {
				message: "Attach files to a draft first.",
			});
		if (input.draftKey)
			await this.attachments.checkDraft(input.draftKey, files);
		const choice = runChoice(input);
		await requireReadyHarness(this.harness, choice);
		const context = await this.references.compose(input, {
			threadId: null,
			scope: input.draftScope ?? null,
		});

		let attachments: JobAttachment[] = [];
		const draftKey = input.draftKey;
		const repositoryId = ids.repositoryId;
		if (checkout) await this.dispatch.freeCheckout(checkout);
		const { investigation } = await this.investigations.startOrGet({
			incidentId: null,
			...(ids.repositoryId ? { repositoryId: ids.repositoryId } : {}),
			...(ids.serviceId ? { serviceId: ids.serviceId } : {}),
			...(helperPlace ? { helperPlace } : {}),
			triggerType: "manual",
			...(tree ? { triggerReason: actionReason(tree.actionId) } : {}),
			kind: "chat",
			title: inlinePlain(tree?.title ?? input.text).slice(0, 120),
			accessLevel: input.accessLevel ?? null,
			onCreate: async (tx, id) => {
				if (tree)
					await tx.investigation.update({
						where: { id },
						data: {
							parentId: tree.parentId,
							rootId: tree.rootId,
							role: tree.role,
							depth: tree.depth,
							...(tree.title ? { titleSetBy: "agent" } : {}),
						},
					});
				if (repositoryId && (await folderBusy(tx, repositoryId, id)))
					throw new ORPCError("CONFLICT", { message: FOLDER_BUSY });
				if (checkout) {
					if (await checkoutBusy(tx, checkout, id))
						throw new ORPCError("CONFLICT", {
							message: await busyReason(tx, checkout, id),
						});
					await takeLease(tx, checkout, id);
				}
				if (draftKey && files.length)
					attachments = placeAttachments(
						await this.attachments.claimDraft(draftKey, files, id, tx),
						files,
						input.attachmentsAt,
					);
			},
		});
		let jobId: string | null;
		try {
			const plain = await this.dispatch.threadRunOf({
				...ids,
				helperPlace: helperPlace ?? null,
			});
			const pin = tree?.at;
			const pinned = pin
				? {
						...plain,
						repos: plain.repos.map((r) => {
							const at = pin(r);
							return at ? { ...r, at } : r;
						}),
					}
				: plain;
			// A thread an agent starts never borrows the user's checkout (#1024).
			const thread = tree
				? { ...pinned, byAgent: true }
				: { ...pinned, ...(checkout ? { checkout } : {}) };
			// The project remembers the person's own choice for its next thread (#1024).
			if (repositoryId && input.workIn && !tree)
				await this.prisma.repository.update({
					where: { id: repositoryId },
					data: { workIn: input.workIn },
				});
			const connections = ids.serviceId
				? await this.integrations.getIntegrationsForService(ids.serviceId)
				: [];
			jobId = await this.dispatch.addInvestigationJob({
				incidentId: null,
				investigationId: investigation.id,
				thread,
				kind: "chat",
				...(connections.length
					? { connectionIds: connections.map((c) => c.connectionId) }
					: {}),
				...(input.accessLevel ? { accessLevel: input.accessLevel } : {}),
				...(tree?.role === SIDE_QUESTION ? { toolFree: true } : {}),
				...choice,
				chat: {
					text: input.text,
					...(attachments.length ? { attachments } : {}),
					...(context ? { context } : {}),
				},
			});
		} catch (e) {
			// The run exists and holds its lease, but no job will ever take it up.
			await this.dispatch.abandonUnstarted(
				investigation.id,
				"The thread could not be started.",
			);
			throw e;
		}
		if (jobId === null)
			await this.dispatch.abandonUnstarted(
				investigation.id,
				"The thread could not be queued.",
			);
		// Only a stored job is a sent message: a failed admission keeps the draft (#1024).
		if (jobId)
			await consumeAfterSend(this.drafts, input.draftScope, input.draftRev);
		return {
			investigationId: investigation.id,
			jobId,
			queued: jobId !== null,
		};
	}

	/**
	 * Where a new thread on this project works (#1024): the request's choice, else the project's
	 * remembered one, else Settings. Only a local git project works in its checkout; answers its
	 * top level as the disk names it, or null for a new worktree.
	 */
	private async checkoutFor(
		repo: {
			sourceKind: string;
			plain: boolean;
			url: string;
			workIn: string | null;
		},
		asked: WorkIn | undefined,
	): Promise<string | null> {
		const local = repo.sourceKind === "folder" && !repo.plain;
		if (asked === "checkout" && !local)
			throw new ORPCError("BAD_REQUEST", { message: NOT_A_CHECKOUT });
		if (!local) return null;
		const chosen =
			asked ??
			WorkInSchema.safeParse(repo.workIn).data ??
			(await this.getSettings()).newThreadsWorkIn ??
			"worktree";
		if (chosen !== "checkout") return null;
		const root = await checkoutRoot(repo.url).catch((e: unknown) => {
			if (e instanceof CheckoutUnreadable)
				throw new ORPCError("SERVICE_UNAVAILABLE", { message: e.message });
			throw e;
		});
		if (!root)
			throw new ORPCError("CONFLICT", {
				message: `Your checkout ${repo.url} is gone or is not a git repository. Start this thread in a new worktree instead.`,
			});
		return root;
	}

	/** A project's or a service's own threads, newest first; never its incidents' or schedules'. */
	async list(query: {
		repositoryId?: string;
		serviceId?: string;
		limit: number;
	}): Promise<InvestigationView[]> {
		if (!query.repositoryId && !query.serviceId) return [];
		const rows = await this.prisma.investigation.findMany({
			where: {
				incidentId: null,
				scheduleId: null,
				...(query.repositoryId
					? { repositoryId: query.repositoryId }
					: { serviceId: query.serviceId, repositoryId: null }),
			},
			orderBy: { createdAt: "desc" },
			take: query.limit,
		});
		return rows.map(threadView);
	}

	/**
	 * Every thread in its section (#1020). Paged by unit: an incident's listed
	 * threads are one unit, so a page never splits a block.
	 */
	async feed(q: ThreadFeedQuery, now = new Date()): Promise<ThreadFeed> {
		const { settleAfterDays } = await this.getSettings();
		const search = q.search?.trim();
		const incidentMatch = incidentSearch(search);
		const literal =
			search && hasWildcard(search)
				? await this.literalThreadIds(search, q)
				: null;
		const rows = await this.prisma.investigation.findMany({
			where: literal
				? {
						id: { in: literal },
						archivedAt: q.archived ? { not: null } : null,
						AND: [LISTED],
					}
				: {
						AND: [LISTED],
						archivedAt: q.archived ? { not: null } : null,
						...(q.kind ? { kind: q.kind } : {}),
						...(q.repositoryId ? { repositoryId: q.repositoryId } : {}),
						...(search
							? {
									OR: [
										{ title: { contains: search } },
										{ service: { is: { name: { contains: search } } } },
										{
											repository: { is: { fullName: { contains: search } } },
										},
										...(incidentMatch
											? [{ incident: { is: incidentMatch } }]
											: []),
									],
								}
							: {}),
					},
			include: FEED_INCLUDE,
			orderBy: { updatedAt: "desc" },
			take: FEED_CAP,
		});
		const lastEvents = rows.length
			? await this.prisma.investigationEvent.groupBy({
					by: ["investigationId"],
					where: { investigationId: { in: rows.map((r) => r.id) } },
					_max: { createdAt: true },
				})
			: [];
		const lastEventAt = new Map(
			lastEvents.map((e) => [e.investigationId, e._max.createdAt]),
		);
		const statuses = await (this.status?.statuses(
			rows.map((row) => ({
				...row,
				lastActivityAt: activityOf(row, lastEventAt.get(row.id)),
			})),
			now,
		) ?? new Map<string, ThreadStatusInfo>());
		const sectioned = rows
			.map((row) => {
				const lastActivityAt = activityOf(row, lastEventAt.get(row.id));
				const facts = { ...row, lastActivityAt };
				const state = statuses.get(row.id);
				return {
					row,
					id: row.id,
					incidentId: row.incidentId,
					lastActivityAt,
					unseen: isUnseen(facts),
					state,
					section: threadSection(facts, now, settleAfterDays, state?.status),
				};
			})
			.filter((r) => !q.since || r.lastActivityAt >= q.since);
		const units = unitsOf(sectioned);
		const counts = { needs: 0, active: 0, settled: 0, needsThreads: 0 };
		for (const u of units) counts[u.section]++;
		for (const t of sectioned) if (t.section === "needs") counts.needsThreads++;
		const listed = q.section
			? units.filter((u) => u.section === q.section)
			: units;
		const page = listed.slice(q.cursor, q.cursor + q.limit);
		const pageIds = page.flatMap((u) => u.threads.map((t) => t.id));
		const texts = await this.latestTexts(pageIds);
		const asks = await this.waitingAsks(
			page.flatMap((u) =>
				u.threads.filter((t) => t.row.awaitingApprovalAt).map((t) => t.id),
			),
		);
		const drafts = await this.drafts.withDrafts(
			pageIds.map((id) => `thread:${id}`),
		);
		const prs = await this.pullRequests.rowGlyphs(pageIds);
		const limits = await this.limits(pageIds);
		const starters = await this.starters(
			page.flatMap((u) => u.threads.map((t) => t.row)),
		);
		return {
			units: page.map((u) => {
				const incident = u.threads[0]?.row.incident ?? null;
				return {
					section: u.section,
					incident: incident
						? {
								id: incident.id,
								number: incident.number,
								title: incident.title,
								severity:
									SeveritySchema.safeParse(incident.severity).data ?? "medium",
								status:
									IncidentStatusSchema.safeParse(incident.status).data ??
									"triggered",
							}
						: null,
					threads: u.threads.map(
						(t): ThreadRow => ({
							...threadView(t.row),
							rootCause: t.row.rootCause,
							section: t.section,
							lastActivityAt: t.lastActivityAt.toISOString(),
							lastVisitedAt: t.row.lastVisitedAt?.toISOString() ?? null,
							settledAt: t.row.settledAt?.toISOString() ?? null,
							unseen: t.unseen,
							latestText: texts.get(t.id) ?? null,
							projectName: t.row.repository
								? shownFullName(t.row.repository)
								: null,
							serviceName: serviceNameOf(t.row),
							startedBy: starters.get(t.id) ?? null,
							titleSetBy:
								t.row.titleSetBy === "user" || t.row.titleSetBy === "agent"
									? t.row.titleSetBy
									: null,
							waitingAsk: asks.get(t.id) ?? null,
							hasDraft: drafts.has(`thread:${t.id}`),
							...(prs.has(t.id) ? { pr: prs.get(t.id) } : {}),
							branch: branchOf(t.row.workspace),
							limit: limits.get(t.id) ?? null,
							paused: pausedOf(t.row.autoPause),
							...(t.state ? { state: t.state } : {}),
							pinnedAt: t.row.pinnedAt?.toISOString() ?? null,
							archivedAt: t.row.archivedAt?.toISOString() ?? null,
						}),
					),
				};
			}),
			nextCursor:
				q.cursor + q.limit < listed.length ? q.cursor + q.limit : null,
			counts,
		};
	}

	/**
	 * Threads stopped on their provider (#1101): a pending `limit` wake (Limited, with
	 * its reset and next try), or a skipped one that gave up or is Blocked. The newest
	 * wake per thread decides; a live run shows none.
	 */
	/** Each row's starter, or the thread a person forked it from (#1101 cat 10). */
	private async starters(
		rows: { id: string; parentId: string | null; role: string | null }[],
	): Promise<Map<string, NonNullable<ThreadRow["startedBy"]>>> {
		const ids = [
			...new Set(rows.flatMap((r) => (r.parentId ? [r.parentId] : []))),
		];
		if (!ids.length) return new Map();
		const found = new Map(
			(
				await this.prisma.investigation.findMany({
					where: { id: { in: ids } },
					select: { id: true, title: true, incidentId: true, scheduleId: true },
				})
			).map((r) => [r.id, r]),
		);
		const out = new Map<string, NonNullable<ThreadRow["startedBy"]>>();
		for (const r of rows) {
			const by = r.parentId ? found.get(r.parentId) : undefined;
			if (!by) continue;
			out.set(r.id, {
				id: by.id,
				title: by.title,
				link: threadLink(by),
				via: r.role === "fork" || r.role === SIDE_QUESTION ? "fork" : "agent",
			});
		}
		return out;
	}

	private async limits(
		ids: string[],
	): Promise<Map<string, NonNullable<ThreadRow["limit"]>>> {
		const out = new Map<string, NonNullable<ThreadRow["limit"]>>();
		if (!ids.length) return out;
		const rows = await this.prisma.threadWake.findMany({
			where: { investigationId: { in: ids }, kind: "limit" },
			orderBy: { createdAt: "desc" },
			select: {
				investigationId: true,
				state: true,
				at: true,
				attempts: true,
				payload: true,
				investigation: {
					select: { limitResetsAt: true, status: true, autoResume: true },
				},
			},
		});
		const seen = new Set<string>();
		for (const r of rows) {
			if (seen.has(r.investigationId)) continue;
			seen.add(r.investigationId);
			if (!isWorkflowTerminal(r.investigation.status)) continue;
			let payload: {
				mode?: unknown;
				gaveUp?: unknown;
				blocked?: unknown;
				noTime?: unknown;
				maxAttempts?: unknown;
			} = {};
			try {
				payload = JSON.parse(r.payload ?? "{}") as typeof payload;
			} catch {
				payload = {};
			}
			const stopped = payload.gaveUp === true || payload.blocked === true;
			if (r.state !== "pending" && !(r.state === "skipped" && stopped))
				continue;
			const mode = FailureModeSchema.safeParse(payload.mode);
			const nextTry = nextTryOf(
				{
					state: r.state as "pending",
					attempts: r.attempts,
					payload: payload as Record<string, unknown>,
				},
				r.investigation.limitResetsAt,
			);
			out.set(r.investigationId, {
				resetsAt: r.investigation.limitResetsAt?.toISOString() ?? null,
				...(nextTry ? { nextTry } : {}),
				...(mode.success ? { mode: mode.data } : {}),
				...(r.state === "pending" && r.investigation.autoResume !== false
					? { nextAttemptAt: r.at.toISOString() }
					: {}),
			});
		}
		return out;
	}

	/** Each thread's newest waiting ask, from its ask events, legacy and new (#1024). */
	private async waitingAsks(
		ids: string[],
	): Promise<Map<string, { kind: AskKind; title: string }>> {
		const out = new Map<string, { kind: AskKind; title: string }>();
		if (ids.length === 0) return out;
		const rows = await this.prisma.investigationEvent.findMany({
			where: {
				investigationId: { in: ids },
				OR: [
					{ event: { contains: '"kind":"permission_' } },
					{ event: { contains: '"kind":"ask_' } },
				],
			},
			orderBy: { seq: "asc" },
			select: { investigationId: true, event: true },
		});
		const byThread = new Map<string, CanonicalEvent[]>();
		for (const r of rows) {
			const parsed = CanonicalEventSchema.safeParse(JSON.parse(r.event));
			if (!parsed.success) continue;
			const list = byThread.get(r.investigationId) ?? [];
			list.push(parsed.data);
			byThread.set(r.investigationId, list);
		}
		for (const [id, events] of byThread) {
			const newest = pendingAsks(id, events).at(-1);
			if (newest) out.set(id, { kind: newest.kind, title: newest.title });
		}
		return out;
	}

	/** The newest threads holding `search` as typed, `%` and `_` included, before the cap (#1020). */
	private async literalThreadIds(
		search: string,
		q: ThreadFeedQuery,
	): Promise<string[]> {
		const like = likePattern(search);
		const kind = q.kind ?? null;
		const repositoryId = q.repositoryId ?? null;
		const rows = await this.prisma.$queryRaw<{ id: string }[]>`
			SELECT i.id FROM investigations i
			LEFT JOIN services s ON s.id = i.serviceId
			LEFT JOIN repositories r ON r.id = i.repositoryId
			LEFT JOIN incidents n ON n.id = i.incidentId
			WHERE (${kind} IS NULL OR i.kind = ${kind})
				AND (${repositoryId} IS NULL OR i.repositoryId = ${repositoryId})
				AND (i.title LIKE ${like} ESCAPE '\\' OR s.name LIKE ${like} ESCAPE '\\'
					OR r.fullName LIKE ${like} ESCAPE '\\' OR n.title LIKE ${like} ESCAPE '\\')
			ORDER BY i.updatedAt DESC
			LIMIT ${FEED_CAP}`;
		return rows.map((r) => r.id);
	}

	/** The agent's latest sentence per thread, plain text, capped. */
	private async latestTexts(ids: string[]): Promise<Map<string, string>> {
		const found = await Promise.all(
			ids.map((id) =>
				this.prisma.investigationEvent.findFirst({
					where: {
						investigationId: id,
						AND: [
							{ event: { contains: '"kind":"agent_step"' } },
							{ NOT: { event: { contains: '"text":""' } } },
						],
					},
					orderBy: { seq: "desc" },
					select: { investigationId: true, event: true },
				}),
			),
		);
		const texts = new Map<string, string>();
		for (const e of found) {
			const text = e ? stepText(e.event) : null;
			if (e && text) texts.set(e.investigationId, text);
		}
		return texts;
	}

	async visit(id: string): Promise<{ lastVisitedAt: string }> {
		const at = new Date();
		if (!(await this.readState(id, { lastVisitedAt: at })))
			throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
		return { lastVisitedAt: at.toISOString() };
	}

	/**
	 * Writes seen or settled state with the row's own updatedAt, which orders the feed (#1020).
	 * A row that changed in between is read again; false when the thread is gone,
	 * CONFLICT when three writes in a row lose the race.
	 */
	private async readState(
		id: string,
		data: { lastVisitedAt?: Date; settledAt?: Date | null },
		/** A put-back writes only while the row still holds what this request wrote there. */
		onlyIfSettledAt?: { value: Date | null },
	): Promise<boolean> {
		for (let attempt = 0; attempt < 3; attempt++) {
			const row = await this.prisma.investigation.findUnique({
				where: { id },
				select: { updatedAt: true, settledAt: true },
			});
			if (!row) return false;
			if (
				onlyIfSettledAt &&
				(row.settledAt?.getTime() ?? null) !==
					(onlyIfSettledAt.value?.getTime() ?? null)
			)
				return true;
			const { count } = await this.prisma.investigation.updateMany({
				where: { id, updatedAt: row.updatedAt },
				data: { ...data, updatedAt: row.updatedAt },
			});
			if (count) return true;
		}
		throw new ORPCError("CONFLICT", { message: "Thread changed, try again" });
	}

	/**
	 * All or nothing, by writing the earlier threads back, not by a transaction: on the SQLite adapter
	 * a rollback would also undo other requests' writes made on the shared connection meanwhile.
	 */
	private async writeSettled(
		writes: Array<{ id: string; settledAt: Date | null }>,
		prior: Map<string, Date | null>,
	): Promise<void> {
		const done: string[] = [];
		const wrote = new Map(writes.map((w) => [w.id, w.settledAt]));
		try {
			for (const w of writes) {
				await this.readState(w.id, { settledAt: w.settledAt });
				done.push(w.id);
			}
		} catch (e) {
			let unrestored = 0;
			for (const id of done.reverse())
				await this.readState(
					id,
					{ settledAt: prior.get(id) ?? null },
					{ value: wrote.get(id) ?? null },
				).catch(() => {
					unrestored++;
				});
			if (unrestored)
				throw new ORPCError("CONFLICT", {
					message: `Thread changed, and ${unrestored} already written could not be put back: reload before trying again`,
					cause: e,
				});
			throw e;
		}
	}

	/**
	 * Settling an incident's thread settles, and marks seen, every thread of that
	 * incident; threads they started run on (#1101 cat 20). Jobs end when Undo's
	 * window closes; a running run stops at once, and only with `stopRunning`.
	 */
	async settle(
		id: string,
		settled: boolean,
		restore?: SettledState[],
		opts: { stopRunning?: boolean; operate?: boolean } = {},
	): Promise<SettleResponse> {
		const block = await this.lifecycle.block(id);
		if (!block.length)
			throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
		const ids = block;
		const rows = await this.prisma.investigation.findMany({
			where: { id: { in: ids } },
			select: {
				id: true,
				settledAt: true,
				lastActivityAt: true,
				updatedAt: true,
				teardownAt: true,
			},
		});
		const prior = new Map(rows.map((r) => [r.id, r.settledAt]));
		const now = new Date();
		if (!settled) return this.unsettle(id, block, rows, prior, now, restore);
		const ended = await this.lifecycle.preview(id);
		if (ended.running && !opts.stopRunning)
			throw new ORPCError("CONFLICT", {
				message: `Settling stops ${ended.running} running ${ended.running === 1 ? "run" : "runs"}. Confirm to stop ${ended.running === 1 ? "it" : "them"}.`,
				data: { reason: "running", running: ended.running },
			});
		const ends =
			ended.wakes + ended.watches + ended.crons + ended.running > 0 ||
			ended.worktrees.some((w) => w.action === "remove");
		// Ending jobs or worktrees takes the permission Stop takes.
		if (ends && opts.operate === false)
			throw new ORPCError("FORBIDDEN", { message: VIEW_ONLY });
		let stopped = ended.running > 0;
		if (stopped) await this.lifecycle.stopRunning(ids);
		else {
			// A wake admitted after the preview is a running run the user has not confirmed.
			const late = await this.lifecycle.liveCount(ids);
			if (late) {
				if (!opts.stopRunning)
					throw new ORPCError("CONFLICT", {
						message: `Settling stops ${late} running ${late === 1 ? "run" : "runs"}. Confirm to stop ${late === 1 ? "it" : "them"}.`,
						data: { reason: "running", running: late },
					});
				await this.lifecycle.stopRunning(ids);
				stopped = true;
			}
		}
		await this.lifecycle.endProcesses(ids);
		// Taken after the stopped runs have ended, so their last write cannot post-date it.
		const settledAt = stopped ? new Date() : now;
		const undoUntil = new Date(settledAt.getTime() + SETTLE_UNDO_MS);
		await this.writeSettled(
			ids.map((target) => ({ id: target, settledAt })),
			prior,
		);
		// A thread settled before keeps its own teardown, as Undo keeps its own state.
		for (const r of rows.filter((x) => !isSettled(x)))
			await this.setTeardown(r.id, undoUntil, r.updatedAt);
		return {
			ids,
			previous: rows.map((r) => ({
				id: r.id,
				settledAt: r.settledAt?.toISOString() ?? null,
			})),
			undoUntil: undoUntil.toISOString(),
			ended,
		};
	}

	/** Undo restores each thread's own state while its teardown waits; after it, "Already ended". */
	private async unsettle(
		id: string,
		block: string[],
		rows: Array<{
			id: string;
			settledAt: Date | null;
			lastActivityAt: Date | null;
			updatedAt: Date;
			teardownAt: Date | null;
		}>,
		prior: Map<string, Date | null>,
		now: Date,
		restore?: SettledState[],
	): Promise<SettleResponse> {
		if (restore) {
			const named = rows.find((r) => r.id === id);
			const over =
				named &&
				isSettled(named) &&
				(!named.teardownAt || named.teardownAt <= now);
			if (over)
				throw new ORPCError("CONFLICT", {
					message: "Already ended",
					data: { reason: "ended" },
				});
			// Undo writes back each thread's own state, an earlier Settle included (#1020).
			const inScope = new Set(block);
			const back = restore.filter((r) => inScope.has(r.id));
			const states = await this.prisma.investigation.findMany({
				where: { id: { in: back.map((r) => r.id) } },
				select: { id: true, settledAt: true, updatedAt: true },
			});
			for (const s of states) prior.set(s.id, s.settledAt);
			await this.writeSettled(
				back.map((r) => ({
					id: r.id,
					settledAt: r.settledAt ? new Date(r.settledAt) : null,
				})),
				prior,
			);
			// A thread settled before the one being undone keeps the teardown it already had.
			const wasOpen = new Set(
				back.filter((r) => r.settledAt === null).map((r) => r.id),
			);
			for (const s of states)
				if (wasOpen.has(s.id)) await this.setTeardown(s.id, null, s.updatedAt);
			return { ids: block, previous: [], undoUntil: null, ended: null };
		}
		// Unsettle with no states to restore clears only the thread named, never its block.
		await this.writeSettled([{ id, settledAt: null }], prior);
		const named = rows.find((r) => r.id === id);
		if (named) await this.setTeardown(id, null, named.updatedAt);
		return { ids: block, previous: [], undoUntil: null, ended: null };
	}

	/** Settling never moves `updatedAt`: the feed's order and the settled test both read it. */
	private async setTeardown(
		id: string,
		at: Date | null,
		updatedAt: Date,
	): Promise<void> {
		await this.prisma.investigation.updateMany({
			where: { id },
			data: { teardownAt: at, updatedAt },
		});
	}

	rename(id: string, title: string): Promise<{ id: string; title: string }> {
		return renameThread(this.prisma, id, title);
	}

	async getSettings(): Promise<ThreadSettings> {
		const row = await this.prisma.setting.findUnique({
			where: { key: SETTINGS_KEY },
		});
		let stored: unknown = null;
		try {
			stored = row ? JSON.parse(row.value) : null;
		} catch {
			stored = null;
		}
		return (
			ThreadSettingsSchema.safeParse(stored).data ?? {
				settleAfterDays: DEFAULT_SETTLE_AFTER_DAYS,
			}
		);
	}

	async updateSettings(next: ThreadSettings): Promise<ThreadSettings> {
		const value = JSON.stringify(next);
		await this.prisma.setting.upsert({
			where: { key: SETTINGS_KEY },
			create: { key: SETTINGS_KEY, value, type: "json", category: "general" },
			update: { value },
		});
		liveChanges.noteTopic("threads");
		return next;
	}
}

/** The row's automatic-updates pause, for Waiting for you; null when none. */
function pausedOf(raw: string | null): AutoPause | null {
	return AutoPauseSchema.safeParse(safeParseJsonObject(raw)).data ?? null;
}

/** The latest of anything that happened on the thread. */
function activityOf(row: FeedRow, lastEventAt: Date | null | undefined): Date {
	let at = row.createdAt;
	for (const d of [
		row.startedAt,
		row.completedAt,
		row.awaitingApprovalAt,
		lastEventAt,
	])
		if (d && d > at) at = d;
	return at;
}

function serviceNameOf(row: FeedRow): string | null {
	const s = row.service ?? row.incident?.service ?? null;
	return s ? s.displayName || s.name : null;
}
