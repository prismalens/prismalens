// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Attention (#1101 categories 3 and 4). Watches every thread's status and records
 * the moves the operator would want to hear about; keeps where they have read each
 * thread to and the per-device presence leases that silence a watched thread.
 */
import {
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	type OnApplicationShutdown,
} from "@nestjs/common";
import {
	type AttentionEvent,
	type AttentionEvents,
	type AttentionEventsInput,
	type AttentionKind,
	AttentionKindSchema,
	type AttentionThread,
	type AwayView,
	type CanonicalEvent,
	CanonicalEventSchema,
	DEFAULT_NOTIFY_PREFS,
	isWorkflowLive,
	LIVE_WORKFLOW_STATUSES,
	type NotifyPrefs,
	NotifyPrefsSchema,
	PendingAskSchema,
	parseEventKey,
	pendingAsks,
	SeveritySchema,
	STOP_REASONS,
	type ThreadRead,
	type ThreadStatus,
	ThreadStatusSchema,
} from "@prismalens/contracts";
import { liveChanges } from "../../core/live/live-changes.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { stepText } from "../incidents/incidents.service.js";
import { ThreadWindowService } from "../investigations/thread-window/thread-window.service.js";
import { SIDE_QUESTION } from "../threads/side-question.js";
import { ThreadStatusService } from "../threads/thread-status.service.js";
import { attentionKindOf, mayNotify, staleKinds } from "./attention-rules.js";
import { PRESENCE_TTL_MS, PresenceLeases } from "./presence.js";

const PREFS_KEY = "attention.prefs";
const ACTIVITY_KEY = "attention.activity";
/** A thread touched this recently is read again on each scan. */
const RECENT_MS = 15 * 60_000;
/** A first sighting this soon after creation is the thread's start. */
const FRESH_MS = 2 * 60_000;
/** Time-based moves (a limit's reset, a wake) are caught on this tick. */
const TICK_MS = 20_000;
/** No visible tab for this long starts a new "away". */
export const AWAY_GAP_MS = 15 * 60_000;
/** Away this long, Home shows a card per thread instead of a line. */
export const LONG_GAP_MS = 2 * 60 * 60_000;
const STILL_GOING: ThreadStatus[] = [
	"working",
	"waiting",
	"approval",
	"question",
	"limited",
];

interface Activity {
	lastActiveAt: string | null;
	awaySince: string | null;
	gapMs: number;
}

/** A thread another thread's agent started; a person's fork or side question was not. */
const agentStarted = (r: { parentId: string | null; role: string | null }) =>
	!!r.parentId && r.role !== "fork" && r.role !== SIDE_QUESTION;

const THREAD_SELECT = {
	id: true,
	title: true,
	kind: true,
	status: true,
	parentId: true,
	rootId: true,
	role: true,
	depth: true,
	triggerType: true,
	scheduleId: true,
	incidentId: true,
	createdAt: true,
	updatedAt: true,
	lastActivityAt: true,
	awaitingApprovalAt: true,
	autoPause: true,
	limitResetsAt: true,
	eventOrdinal: true,
	eventGeneration: true,
	rootCause: true,
	report: true,
	summary: true,
	error: true,
	endReason: true,
	incident: { select: { id: true, number: true, severity: true, title: true } },
	completedAt: true,
	attention: { select: { lastStatus: true, follow: true, turnEndedAt: true } },
} as const;

/** A person started it: not an alert, a schedule, or another thread. */
export function triggered(row: {
	triggerType: string | null;
	scheduleId: string | null;
	incidentId: string | null;
}): boolean {
	if (row.scheduleId) return true;
	const t = row.triggerType;
	if (t && t !== "manual" && t !== "re_trigger") return true;
	return !!row.incidentId && !t;
}

@Injectable()
export class AttentionService
	implements OnApplicationBootstrap, OnApplicationShutdown
{
	private readonly logger = new Logger(AttentionService.name);
	readonly presence = new PresenceLeases();
	private readonly stop = new AbortController();
	private timer: NodeJS.Timeout | undefined;
	private scanning: Promise<number> | null = null;
	private again = false;
	private debounce: NodeJS.Timeout | undefined;

	constructor(
		private readonly prisma: PrismaService,
		private readonly statuses: ThreadStatusService,
		private readonly window: ThreadWindowService,
	) {}

	onApplicationBootstrap(): void {
		this.window.registerPosition("unread", (id, p) =>
			this.firstUnseen(id, p).then((u) => u.key),
		);
		void this.follow();
		this.timer = setInterval(() => this.soon(), TICK_MS);
		this.timer.unref();
		this.soon();
	}

	onApplicationShutdown(): void {
		this.stop.abort();
		clearInterval(this.timer);
		clearTimeout(this.debounce);
	}

	/** Re-scan on each change hint for runs and their events. */
	private async follow(): Promise<void> {
		try {
			for await (const change of liveChanges.subscribe(this.stop.signal))
				if (
					change.topics.includes("investigations") ||
					change.topics.includes("threads")
				)
					this.soon();
		} catch (error) {
			this.logger.warn(`Attention stopped following changes: ${error}`);
		}
	}

	private soon(): void {
		clearTimeout(this.debounce);
		this.debounce = setTimeout(() => {
			void this.scan().catch((error: unknown) =>
				this.logger.warn(`Attention scan failed: ${String(error)}`),
			);
		}, 300);
		this.debounce.unref?.();
	}

	/** One scan at a time; a hint during a scan runs one more after it. */
	scan(now = new Date()): Promise<number> {
		if (this.scanning) {
			this.again = true;
			return this.scanning;
		}
		this.scanning = this.scanOnce(now).finally(() => {
			this.scanning = null;
			if (this.again) {
				this.again = false;
				this.soon();
			}
		});
		return this.scanning;
	}

	/** Compares each candidate thread's status with the last one seen; returns events recorded. */
	private async scanOnce(now: Date): Promise<number> {
		const since = new Date(now.getTime() - RECENT_MS);
		const asked = await this.prisma.toolAsk.findMany({
			where: { status: "open", openedAt: { gte: since } },
			select: { threadId: true },
		});
		const rows = await this.prisma.investigation.findMany({
			where: {
				archivedAt: null,
				OR: [
					{ status: { in: [...LIVE_WORKFLOW_STATUSES] } },
					{ updatedAt: { gte: since } },
					{ lastActivityAt: { gte: since } },
					{ attention: { is: { lastStatus: { in: STILL_GOING } } } },
					{ id: { in: asked.map((a) => a.threadId) } },
				],
			},
			select: THREAD_SELECT,
			take: 500,
		});
		if (!rows.length) return 0;
		const status = await this.statuses.statuses(
			rows.map((r) => ({
				id: r.id,
				status: r.status,
				awaitingApprovalAt: r.awaitingApprovalAt,
				autoPause: r.autoPause,
				lastActivityAt: r.lastActivityAt ?? r.updatedAt,
			})),
			now,
		);
		let recorded = 0;
		for (const row of rows) {
			const info = status.get(row.id);
			if (!info) continue;
			const next = info.status;
			const seen = row.attention;
			const ended = row.completedAt;
			// A turn that started and ended between two scans shows only a newer end.
			const newTurn =
				!!seen &&
				!!ended &&
				(!seen.turnEndedAt || ended > seen.turnEndedAt) &&
				!isWorkflowLive(row.status);
			const prev =
				seen === null
					? undefined
					: newTurn && seen.turnEndedAt
						? "working"
						: (ThreadStatusSchema.safeParse(seen.lastStatus).data ?? null);
			if (prev === next && !newTurn) continue;
			const isTriggered = triggered(row);
			const kind = attentionKindOf({
				prev,
				next,
				triggered: isTriggered,
				fresh: now.getTime() - row.createdAt.getTime() <= FRESH_MS,
			});
			await this.prisma.threadAttention.upsert({
				where: { investigationId: row.id },
				create: {
					investigationId: row.id,
					lastStatus: next,
					turnEndedAt: ended,
				},
				update: { lastStatus: next, turnEndedAt: ended },
			});
			const stale = staleKinds(next);
			await this.prisma.attentionEvent.updateMany({
				where: {
					investigationId: row.id,
					readAt: null,
					kind: { in: stale },
				},
				data: { readAt: now },
			});
			if (!kind) continue;
			await this.record(row, kind, next, info.mode ?? null, isTriggered, now);
			recorded++;
		}
		liveChanges.noteTopic("attention");
		return recorded;
	}

	/**
	 * A usage limit is the account's, not one thread's: once one limited thread has notified for
	 * a window still running, an agent-started thread hitting it adds no second notice (#1101 cat 10).
	 */
	private async limitAlreadyTold(
		kind: AttentionKind,
		row: { parentId: string | null; role: string | null },
		now: Date,
	): Promise<boolean> {
		if (
			kind !== "limited" ||
			!agentStarted(row) ||
			STOP_REASONS.usage_limit.tellsHuman !== "once_per_limit"
		)
			return false;
		return (
			(await this.prisma.attentionEvent.count({
				where: { kind: "limited", notify: true, resetsAt: { gt: now } },
			})) > 0
		);
	}

	private async record(
		row: {
			id: string;
			parentId: string | null;
			role: string | null;
			eventOrdinal: number;
			eventGeneration: number;
			limitResetsAt: Date | null;
			triggerType: string | null;
			attention: { follow: string | null } | null;
		},
		kind: AttentionKind,
		next: ThreadStatus,
		mode: string | null,
		isTriggered: boolean,
		now: Date,
	): Promise<void> {
		const follow =
			row.attention?.follow === "watch" || row.attention?.follow === "mute"
				? row.attention.follow
				: null;
		const notify =
			mayNotify({
				kind,
				follow,
				agentStarted: agentStarted(row),
				triggered: isTriggered,
			}) && !(await this.limitAlreadyTold(kind, row, now));
		const viewers = this.presence.viewers(row.id, now.getTime());
		const revoked = viewers.length
			? new Set(
					(
						await this.prisma.deviceSession.findMany({
							where: { id: { in: viewers }, revokedAt: { not: null } },
							select: { id: true },
						})
					).map((d) => d.id),
				)
			: new Set<string>();
		const silenced = viewers.some((v) => !revoked.has(v));
		const detail =
			kind === "needs_you"
				? await this.askTitle(row.id)
				: kind === "limited" || kind === "blocked"
					? mode
					: kind === "started"
						? row.triggerType
						: null;
		await this.prisma.attentionEvent.create({
			data: {
				investigationId: row.id,
				kind,
				status: next,
				detail,
				resetsAt: kind === "limited" ? row.limitResetsAt : null,
				ordinal: row.eventOrdinal,
				generation: row.eventGeneration,
				notify,
				silenced,
				createdAt: now,
			},
		});
	}

	/** The newest open ask's title: a run's from its record, a tool's from its table. */
	private async askTitle(id: string): Promise<string | null> {
		const tool = await this.prisma.toolAsk.findFirst({
			where: { threadId: id, status: "open" },
			orderBy: { openedAt: "desc" },
			select: { ask: true },
		});
		if (tool) {
			const ask = PendingAskSchema.safeParse(JSON.parse(tool.ask));
			if (ask.success) return ask.data.title;
		}
		const rows = await this.prisma.investigationEvent.findMany({
			where: {
				investigationId: id,
				OR: [
					{ event: { contains: '"kind":"permission_' } },
					{ event: { contains: '"kind":"ask_' } },
				],
			},
			orderBy: { seq: "asc" },
			select: { event: true },
		});
		const events: CanonicalEvent[] = [];
		for (const r of rows) {
			const parsed = CanonicalEventSchema.safeParse(JSON.parse(r.event));
			if (parsed.success) events.push(parsed.data);
		}
		return pendingAsks(id, events).at(-1)?.title ?? null;
	}

	// ---- the event list and the away view ----

	async events(input: AttentionEventsInput): Promise<AttentionEvents> {
		const rows = await this.prisma.attentionEvent.findMany({
			where: {
				...(input.filter === "unread" ? { readAt: null } : {}),
				investigation: { archivedAt: null },
			},
			orderBy: { createdAt: "desc" },
			take: input.limit,
		});
		const unread = await this.prisma.attentionEvent.count({
			where: { readAt: null, investigation: { archivedAt: null } },
		});
		return { events: await this.views(rows), unread };
	}

	async markRead(ids?: string[], now = new Date()): Promise<number> {
		const { count } = await this.prisma.attentionEvent.updateMany({
			where: { readAt: null, ...(ids ? { id: { in: ids } } : {}) },
			data: { readAt: now },
		});
		if (count) liveChanges.noteTopic("attention");
		return count;
	}

	async away(): Promise<AwayView> {
		const activity = await this.activity();
		const rows = await this.prisma.attentionEvent.findMany({
			where: { readAt: null, investigation: { archivedAt: null } },
			orderBy: { createdAt: "desc" },
			take: 200,
		});
		const events = await this.views(rows);
		// One group per thread: a started thread is a sibling, never rolled into its starter (#1101 cat 3).
		const byThread = new Map<string, AttentionEvent[]>();
		for (const e of events)
			byThread.set(e.thread.id, [...(byThread.get(e.thread.id) ?? []), e]);
		const groups: AwayView["groups"] = [...byThread.values()].flatMap((list) =>
			list[0]
				? [
						{
							root: list[0].thread,
							threads: [{ thread: list[0].thread, events: list }],
						},
					]
				: [],
		);
		return {
			since: activity.awaySince,
			long: activity.gapMs >= LONG_GAP_MS,
			groups,
		};
	}

	private async views(
		rows: Array<{
			id: string;
			investigationId: string;
			kind: string;
			detail: string | null;
			resetsAt: Date | null;
			createdAt: Date;
			readAt: Date | null;
			notify: boolean;
			silenced: boolean;
		}>,
	): Promise<AttentionEvent[]> {
		const threads = new Map(
			(
				await this.threads([...new Set(rows.map((r) => r.investigationId))])
			).map((t) => [t.id, t]),
		);
		const out: AttentionEvent[] = [];
		for (const r of rows) {
			const thread = threads.get(r.investigationId);
			const kind = AttentionKindSchema.safeParse(r.kind);
			if (!thread || !kind.success) continue;
			out.push({
				id: r.id,
				threadId: r.investigationId,
				kind: kind.data,
				detail: r.detail,
				resetsAt: r.resetsAt?.toISOString() ?? null,
				at: r.createdAt.toISOString(),
				readAt: r.readAt?.toISOString() ?? null,
				notify: r.notify,
				silenced: r.silenced,
				thread,
			});
		}
		return out;
	}

	/** What a card or a notification says about each thread. */
	async threads(ids: string[], now = new Date()): Promise<AttentionThread[]> {
		if (!ids.length) return [];
		const rows = await this.prisma.investigation.findMany({
			where: { id: { in: ids } },
			select: THREAD_SELECT,
		});
		const starterIds = [
			...new Set(
				rows.flatMap((r) =>
					agentStarted(r) && r.parentId ? [r.parentId] : [],
				),
			),
		];
		const starterTitles = new Map(
			(
				await this.prisma.investigation.findMany({
					where: { id: { in: starterIds } },
					select: { id: true, title: true },
				})
			).map((r) => [r.id, r.title]),
		);
		const status = await this.statuses.statuses(
			rows.map((r) => ({
				id: r.id,
				status: r.status,
				awaitingApprovalAt: r.awaitingApprovalAt,
				autoPause: r.autoPause,
				lastActivityAt: r.lastActivityAt ?? r.updatedAt,
			})),
			now,
		);
		const answers = await this.answers(rows.map((r) => r.id));
		return rows.map((r) => {
			const report = handover(r.report);
			const starterId = agentStarted(r) ? r.parentId : null;
			return {
				id: r.id,
				// A run an alert started has no brief of its own: its incident's title names it.
				title: r.title ?? r.incident?.title ?? null,
				kind: r.kind,
				startedBy: starterId
					? { id: starterId, title: starterTitles.get(starterId) ?? null }
					: null,
				incident: r.incident
					? {
							id: r.incident.id,
							number: r.incident.number,
							severity:
								SeveritySchema.safeParse(r.incident.severity).data ?? "medium",
						}
					: null,
				cause: report.cause ?? r.rootCause,
				nextCommand: report.command,
				// A scheduled run often records only its summary, no agent text (#1101 cat 3).
				answer: answers.get(r.id) ?? r.summary ?? null,
				error: r.status === "failed" ? r.error : null,
				endReason: r.endReason,
				status: status.get(r.id)?.status ?? null,
				follow:
					r.attention?.follow === "watch" || r.attention?.follow === "mute"
						? r.attention.follow
						: null,
			};
		});
	}

	/** The agent's latest sentence per thread. */
	private async answers(ids: string[]): Promise<Map<string, string>> {
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
		const out = new Map<string, string>();
		for (const e of found) {
			const text = e ? stepText(e.event) : null;
			if (e && text) out.set(e.investigationId, text);
		}
		return out;
	}

	// ---- read positions ----

	/** The first unseen message after the read position, and how many there are. */
	private async firstUnseen(
		id: string,
		p: {
			gen: number;
			entries: Array<{ key: string; ordinal: number; entry: unknown }>;
		},
	): Promise<{ key: string | null; count: number; readAt: Date | null }> {
		const read = await this.prisma.threadRead.findUnique({
			where: { investigationId: id },
		});
		if (!read) return { key: null, count: 0, readAt: null };
		const after = read.generation === p.gen ? read.ordinal : -1;
		let key: string | null = null;
		let count = 0;
		for (const e of p.entries) {
			if (e.ordinal <= after || !e.entry) continue;
			key ??= e.key;
			count++;
		}
		return { key, count, readAt: read.readAt };
	}

	async threadRead(id: string): Promise<ThreadRead> {
		const p = await this.window.projection(id);
		const u = await this.firstUnseen(id, p);
		return {
			readAt: u.readAt?.toISOString() ?? null,
			firstUnseen: u.key,
			newCount: u.count,
		};
	}

	/**
	 * Advances the read position to the event shown; never moves it back. Reaching
	 * the tail also marks the thread visited, which clears its unseen mark.
	 */
	async markThreadRead(
		id: string,
		key: string,
		now = new Date(),
	): Promise<boolean> {
		const at = parseEventKey(key);
		if (!at) return false;
		const [thread, event] = await Promise.all([
			this.prisma.investigation.findUnique({
				where: { id },
				select: { eventGeneration: true, eventOrdinal: true },
			}),
			this.prisma.investigationEvent.findFirst({
				where: { investigationId: id, branchId: at.branchId, seq: at.seq },
				select: { ordinal: true },
			}),
		]);
		if (!thread || !event) return false;
		const gen = thread.eventGeneration;
		const read = await this.prisma.threadRead.findUnique({
			where: { investigationId: id },
		});
		if (read && read.generation === gen && read.ordinal >= event.ordinal)
			return false;
		await this.prisma.threadRead.upsert({
			where: { investigationId: id },
			create: {
				investigationId: id,
				generation: gen,
				ordinal: event.ordinal,
				readAt: now,
			},
			update: { generation: gen, ordinal: event.ordinal, readAt: now },
		});
		const tail = event.ordinal >= thread.eventOrdinal;
		await this.prisma.attentionEvent.updateMany({
			where: {
				investigationId: id,
				readAt: null,
				...(tail ? {} : { ordinal: { lte: event.ordinal } }),
			},
			data: { readAt: now },
		});
		if (tail) {
			const row = await this.prisma.investigation.findUnique({
				where: { id },
				select: { updatedAt: true },
			});
			if (row)
				await this.prisma.investigation.updateMany({
					where: { id, updatedAt: row.updatedAt },
					data: { lastVisitedAt: now, updatedAt: row.updatedAt },
				});
		}
		liveChanges.noteTopic("attention");
		liveChanges.noteTopic("threads");
		return true;
	}

	// ---- presence and away ----

	async hold(
		deviceId: string,
		threadId: string | null,
		visible: boolean,
		now = new Date(),
	): Promise<{ ttlMs: number }> {
		if (!visible) {
			this.presence.drop(deviceId);
			return { ttlMs: PRESENCE_TTL_MS };
		}
		this.presence.hold(deviceId, threadId, now.getTime());
		await this.touch(now);
		return { ttlMs: PRESENCE_TTL_MS };
	}

	/** Notes the operator is here; a gap since the last visible tab starts a new away. */
	async touch(now = new Date()): Promise<Activity> {
		const a = await this.activity();
		const last = a.lastActiveAt ? Date.parse(a.lastActiveAt) : null;
		const gap = last === null ? 0 : now.getTime() - last;
		if (last !== null && gap < 30_000) return a;
		const next: Activity =
			last === null || gap >= AWAY_GAP_MS
				? {
						lastActiveAt: now.toISOString(),
						awaySince: a.lastActiveAt,
						gapMs: gap,
					}
				: { ...a, lastActiveAt: now.toISOString() };
		await this.writeSetting(ACTIVITY_KEY, next);
		return next;
	}

	async activity(): Promise<Activity> {
		const raw = await this.readSetting(ACTIVITY_KEY);
		const v = (raw ?? {}) as Partial<Activity>;
		return {
			lastActiveAt: typeof v.lastActiveAt === "string" ? v.lastActiveAt : null,
			awaySince: typeof v.awaySince === "string" ? v.awaySince : null,
			gapMs: typeof v.gapMs === "number" ? v.gapMs : 0,
		};
	}

	// ---- choices ----

	async prefs(): Promise<NotifyPrefs> {
		return (
			NotifyPrefsSchema.safeParse(await this.readSetting(PREFS_KEY)).data ??
			DEFAULT_NOTIFY_PREFS
		);
	}

	async setPrefs(prefs: NotifyPrefs): Promise<NotifyPrefs> {
		await this.writeSetting(PREFS_KEY, prefs);
		liveChanges.noteTopic("attention");
		return prefs;
	}

	async setFollow(
		id: string,
		follow: "watch" | "mute" | null,
	): Promise<{ follow: "watch" | "mute" | null } | null> {
		const thread = await this.prisma.investigation.findUnique({
			where: { id },
			select: { id: true },
		});
		if (!thread) return null;
		await this.prisma.threadAttention.upsert({
			where: { investigationId: id },
			create: { investigationId: id, follow },
			update: { follow },
		});
		liveChanges.noteTopic("attention");
		return { follow };
	}

	private async readSetting(key: string): Promise<unknown> {
		const row = await this.prisma.setting.findUnique({ where: { key } });
		if (!row) return null;
		try {
			return JSON.parse(row.value) as unknown;
		} catch {
			return null;
		}
	}

	private async writeSetting(key: string, value: unknown): Promise<void> {
		const json = JSON.stringify(value);
		await this.prisma.setting.upsert({
			where: { key },
			create: { key, value: json, type: "json", category: "notifications" },
			update: { value: json },
		});
	}
}

/** An incident report's cause and its first command, for the handover card. */
export function handover(raw: string | null): {
	cause: string | null;
	command: string | null;
} {
	if (!raw) return { cause: null, command: null };
	try {
		const r = JSON.parse(raw) as {
			rootCause?: unknown;
			nextSteps?: Array<{ command?: unknown }>;
		};
		const command = Array.isArray(r.nextSteps)
			? r.nextSteps.find((s) => typeof s?.command === "string")?.command
			: undefined;
		return {
			cause: typeof r.rootCause === "string" ? r.rootCause : null,
			command: typeof command === "string" ? command : null,
		};
	} catch {
		return { cause: null, command: null };
	}
}
