// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import type {
	Investigation as InvestigationView,
	JobAttachment,
	RunChoice,
	SettledState,
	StartThreadInput,
	ThreadFeed,
	ThreadFeedQuery,
	ThreadRow,
	ThreadSettings,
} from "@prismalens/contracts";
import {
	AccessLevelSchema,
	type AskKind,
	type CanonicalEvent,
	CanonicalEventSchema,
	DEFAULT_SETTLE_AFTER_DAYS,
	IncidentStatusSchema,
	pendingAsks,
	SeveritySchema,
	ThreadSettingsSchema,
} from "@prismalens/contracts";
import type { Investigation, Prisma } from "@prismalens/database";
import { HarnessService } from "../../core/harness/harness.service.js";
import { requireReadyHarness } from "../../core/harness/ready-harness.js";
import { liveChanges } from "../../core/live/live-changes.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import {
	FOLDER_BUSY,
	folderBusy,
} from "../../infrastructure/dispatch/folder-lock.js";
import { hasWildcard, likePattern } from "../../shared/utils/literal-like.js";
import { consumeAfterSend, DraftsService } from "../composer/drafts.service.js";
import { incidentSearch, stepText } from "../incidents/incidents.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { AttachmentsService } from "../investigations/attachments.service.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
import { threadSubject } from "../investigations/run-scope.js";
import { ReferencesService } from "../references/references.service.js";
import { shownFullName } from "../repositories/serialize-repository.js";
import { endAgentWakes } from "../wakes/agent-wakes.js";
import { PullRequestsService } from "./pull-requests.service.js";
import { isUnseen, threadSection, unitsOf } from "./thread-sections.js";
import { renameThread } from "./thread-titles.js";

const SETTINGS_KEY = "threads.list";
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

/** Where a thread an agent started sits in its tree (#1024 spec F). */
export interface TreePlacement {
	parentId: string;
	rootId: string;
	role: string;
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
function runChoice({ harness, model, effort }: RunChoice): RunChoice {
	return {
		...(harness ? { harness } : {}),
		...(model !== undefined ? { model } : {}),
		...(effort !== undefined ? { effort } : {}),
	};
}

/** A thread list row; agent text such as the title is shown as plain text only. */
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
		if (ids.repositoryId) {
			const found = await this.prisma.repository.findUnique({
				where: { id: ids.repositoryId },
				select: { id: true },
			});
			if (!found)
				throw new ORPCError("NOT_FOUND", { message: "Project not found" });
		}
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
		const { investigation } = await this.investigations.startOrGet({
			incidentId: null,
			...(ids.repositoryId ? { repositoryId: ids.repositoryId } : {}),
			...(ids.serviceId ? { serviceId: ids.serviceId } : {}),
			...(helperPlace ? { helperPlace } : {}),
			triggerType: "manual",
			...(tree ? { triggerReason: actionReason(tree.actionId) } : {}),
			kind: "chat",
			title: (tree?.title ?? input.text).slice(0, 120),
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
				if (draftKey && files.length)
					attachments = await this.attachments.claimDraft(
						draftKey,
						files,
						id,
						tx,
					);
			},
		});
		const plain = await this.dispatch.threadRunOf({
			...ids,
			helperPlace: helperPlace ?? null,
		});
		const pin = tree?.at;
		const thread = pin
			? {
					...plain,
					repos: plain.repos.map((r) => {
						const at = pin(r);
						return at ? { ...r, at } : r;
					}),
				}
			: plain;
		const connections = ids.serviceId
			? await this.integrations.getIntegrationsForService(ids.serviceId)
			: [];
		const jobId = await this.dispatch.addInvestigationJob({
			incidentId: null,
			investigationId: investigation.id,
			thread,
			kind: "chat",
			...(connections.length
				? { connectionIds: connections.map((c) => c.connectionId) }
				: {}),
			...(input.accessLevel ? { accessLevel: input.accessLevel } : {}),
			...choice,
			chat: {
				text: input.text,
				...(attachments.length ? { attachments } : {}),
				...(context ? { context } : {}),
			},
		});
		// Only a stored job is a sent message: a failed admission keeps the draft (#1024).
		if (jobId)
			await consumeAfterSend(this.drafts, input.draftScope, input.draftRev);
		return {
			investigationId: investigation.id,
			jobId,
			queued: jobId !== null,
		};
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
				? { id: { in: literal } }
				: {
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
		const sectioned = rows
			.map((row) => {
				const lastActivityAt = activityOf(row, lastEventAt.get(row.id));
				const facts = { ...row, lastActivityAt };
				return {
					row,
					id: row.id,
					incidentId: row.incidentId,
					rootId: row.rootId,
					lastActivityAt,
					unseen: isUnseen(facts),
					section: threadSection(facts, now, settleAfterDays),
				};
			})
			.filter((r) => !q.since || r.lastActivityAt >= q.since);
		const units = unitsOf(sectioned);
		const counts = { needs: 0, active: 0, settled: 0 };
		for (const u of units) counts[u.section]++;
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
							tree: t.row.rootId
								? {
										rootId: t.row.rootId,
										parentId: t.row.parentId,
										role: t.row.role,
										depth: t.row.depth,
									}
								: null,
							titleSetBy:
								t.row.titleSetBy === "user" || t.row.titleSetBy === "agent"
									? t.row.titleSetBy
									: null,
							waitingAsk: asks.get(t.id) ?? null,
							hasDraft: drafts.has(`thread:${t.id}`),
							...(prs.has(t.id) ? { pr: prs.get(t.id) } : {}),
						}),
					),
				};
			}),
			nextCursor:
				q.cursor + q.limit < listed.length ? q.cursor + q.limit : null,
			counts,
		};
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

	/** Settling an incident's thread settles, and marks seen, every thread of that incident. */
	async settle(
		id: string,
		settled: boolean,
		restore?: SettledState[],
	): Promise<{ ids: string[]; previous: SettledState[] }> {
		const row = await this.prisma.investigation.findUnique({
			where: { id },
			select: { incidentId: true },
		});
		if (!row) throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
		const where = row.incidentId ? { incidentId: row.incidentId } : { id };
		const rows = await this.prisma.investigation.findMany({
			where,
			select: { id: true, settledAt: true },
		});
		const ids = rows.map((r) => r.id);
		const prior = new Map(rows.map((r) => [r.id, r.settledAt]));
		if (!settled && restore) {
			// Undo writes back each thread's own state, an earlier Settle included (#1020).
			const inBlock = new Set(ids);
			await this.writeSettled(
				restore
					.filter((r) => inBlock.has(r.id))
					.map((r) => ({
						id: r.id,
						settledAt: r.settledAt ? new Date(r.settledAt) : null,
					})),
				prior,
			);
			return { ids, previous: [] };
		}
		// Undo with no states to restore clears only the thread named, never its block.
		const at = settled ? new Date() : null;
		await this.writeSettled(
			(settled ? ids : [id]).map((target) => ({ id: target, settledAt: at })),
			prior,
		);
		// After the settle is written: a failed settle keeps what the agent scheduled.
		if (settled) await endAgentWakes(this.prisma, ids);
		return {
			ids,
			previous: settled
				? rows.map((r) => ({
						id: r.id,
						settledAt: r.settledAt?.toISOString() ?? null,
					}))
				: [],
		};
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
