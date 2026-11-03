// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import type {
	Investigation as InvestigationView,
	JobAttachment,
	RunChoice,
	StartThreadInput,
	ThreadFeed,
	ThreadFeedQuery,
	ThreadRow,
	ThreadSettings,
} from "@prismalens/contracts";
import {
	AccessLevelSchema,
	DEFAULT_SETTLE_AFTER_DAYS,
	IncidentStatusSchema,
	SeveritySchema,
	ThreadSettingsSchema,
} from "@prismalens/contracts";
import type { Investigation, Prisma } from "@prismalens/database";
import { HarnessService } from "../../core/harness/harness.service.js";
import { requireReadyHarness } from "../../core/harness/ready-harness.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import {
	hasLiteral,
	incidentSearch,
	likeEach,
	stepText,
} from "../incidents/incidents.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { AttachmentsService } from "../investigations/attachments.service.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
import { threadSubject } from "../investigations/run-scope.js";
import { shownFullName } from "../repositories/serialize-repository.js";
import { isUnseen, threadSection, unitsOf } from "./thread-sections.js";

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
	) {}

	async start(input: StartThreadInput): Promise<{
		investigationId: string;
		jobId: string | null;
		queued: boolean;
	}> {
		const subject = input.subject;
		const ids = {
			repositoryId: subject.kind === "project" ? subject.repositoryId : null,
			serviceId: subject.kind === "service" ? subject.serviceId : null,
		};
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

		let attachments: JobAttachment[] = [];
		const draftKey = input.draftKey;
		const { investigation } = await this.investigations.startOrGet({
			incidentId: null,
			...(ids.repositoryId ? { repositoryId: ids.repositoryId } : {}),
			...(ids.serviceId ? { serviceId: ids.serviceId } : {}),
			triggerType: "manual",
			kind: "chat",
			title: input.text.slice(0, 120),
			accessLevel: input.accessLevel ?? null,
			...(draftKey && files.length
				? {
						onCreate: async (tx, id) => {
							attachments = await this.attachments.claimDraft(
								draftKey,
								files,
								id,
								tx,
							);
						},
					}
				: {}),
		});
		const thread = await this.dispatch.threadRunOf(ids);
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
			},
		});
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
		const found = await this.prisma.investigation.findMany({
			where: {
				...(q.kind ? { kind: q.kind } : {}),
				...(q.repositoryId ? { repositoryId: q.repositoryId } : {}),
				...(search
					? {
							OR: [
								likeEach(search, (p) => ({ title: { contains: p } })),
								{
									service: {
										is: likeEach(search, (p) => ({ name: { contains: p } })),
									},
								},
								{
									repository: {
										is: likeEach(search, (p) => ({
											fullName: { contains: p },
										})),
									},
								},
								...(incidentMatch ? [{ incident: { is: incidentMatch } }] : []),
							],
						}
					: {}),
			},
			include: FEED_INCLUDE,
			orderBy: { updatedAt: "desc" },
			take: FEED_CAP,
		});
		const rows =
			search && /[%_]/.test(search)
				? found.filter((r) =>
						hasLiteral(search, [
							r.title,
							r.service?.name,
							r.repository?.fullName,
							r.incident?.title,
						]),
					)
				: found;
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
		const texts = await this.latestTexts(
			page.flatMap((u) => u.threads.map((t) => t.id)),
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
						}),
					),
				};
			}),
			nextCursor:
				q.cursor + q.limit < listed.length ? q.cursor + q.limit : null,
			counts,
		};
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
		const { count } = await this.prisma.investigation.updateMany({
			where: { id },
			data: { lastVisitedAt: at },
		});
		if (count === 0)
			throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
		return { lastVisitedAt: at.toISOString() };
	}

	/** Settling an incident's thread settles, and marks seen, every thread of that incident. */
	async settle(id: string, settled: boolean): Promise<{ ids: string[] }> {
		const row = await this.prisma.investigation.findUnique({
			where: { id },
			select: { incidentId: true },
		});
		if (!row) throw new ORPCError("NOT_FOUND", { message: "Thread not found" });
		const where = row.incidentId ? { incidentId: row.incidentId } : { id };
		const ids = (
			await this.prisma.investigation.findMany({ where, select: { id: true } })
		).map((r) => r.id);
		await this.prisma.investigation.updateMany({
			where: { id: { in: ids } },
			// Only settledAt changes, so Undo restores exactly what Settle hid.
			data: { settledAt: settled ? new Date() : null },
		});
		return { ids };
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
