// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	forwardRef,
	Inject,
	Injectable,
	Logger,
	type OnModuleInit,
	Optional,
} from "@nestjs/common";
import {
	type CanonicalEvent,
	FAILURE_MODES,
	type FailureMode,
	type InboundCause,
	type InboundSource,
	type InboundState,
	inboundLine,
	isWorkflowTerminal,
	LIMIT_WINDOWS,
	type LimitWindow,
	type RunFailure,
	RunFailureSchema,
	type WakeKind,
} from "@prismalens/contracts";
import * as clock from "../../core/clock.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
import { StreamRelayService } from "../investigations/stream-relay.service.js";
import { TREE_BRANCH, treeMessageText } from "../thread-tree/tree-text.js";
import { registryFacts } from "./session.js";

type Inbound = Extract<CanonicalEvent, { kind: "message_inbound" }>;
export type InboundEntry = Pick<
	Inbound,
	"messageId" | "source" | "from" | "failure" | "cause" | "prEvents"
> & {
	state: InboundState;
	arrivedAt: Date;
	text: string;
	merged?: { into: string; at: Date };
};

/** Why a message waits on a thread: the provider stop it is under, or a plain cause. */
export type WaitReason =
	| { failure: Pick<RunFailure, "mode" | "window"> }
	| { cause: InboundCause };

/** The source an incoming wake's message reads as. */
export function wakeSource(kind: WakeKind): InboundSource {
	if (kind === "cron") return "schedule";
	if (kind === "pr_status" || kind === "pr_watch") return "pr";
	return "wake";
}

const modeOf = (v: unknown): FailureMode | undefined =>
	(FAILURE_MODES as readonly unknown[]).includes(v)
		? (v as FailureMode)
		: undefined;
const windowOf = (v: unknown): LimitWindow | undefined =>
	(LIMIT_WINDOWS as readonly unknown[]).includes(v)
		? (v as LimitWindow)
		: undefined;

/**
 * Messages a thread did not write itself (#1101 category 17 item 9): each keeps its
 * own outcome as `message_inbound` events, and none reopens a thread a provider stopped.
 */
@Injectable()
export class InboxService implements OnModuleInit {
	private readonly logger = new Logger(InboxService.name);

	constructor(
		private readonly prisma: PrismaService,
		@Inject(forwardRef(() => InvestigationsService))
		private readonly investigations: InvestigationsService,
		@Optional()
		@Inject(forwardRef(() => StreamRelayService))
		private readonly relay?: StreamRelayService,
	) {}

	onModuleInit(): void {
		this.investigations.onEventsAppended((id, events) =>
			this.markDelivered(id, events),
		);
	}

	/**
	 * The provider stop an ended thread is under: a usage limit or retry waiting on its
	 * clock, a Blocked account, or retries spent. Read from the turn's own error too,
	 * since the stop's wake is written just after the run ends.
	 */
	async providerStop(
		threadId: string,
	): Promise<Pick<RunFailure, "mode" | "window"> | null> {
		const row = await this.prisma.investigation.findUnique({
			where: { id: threadId },
			select: { status: true, endReason: true },
		});
		if (row?.status !== "failed") return null;
		const wake = await this.prisma.threadWake.findFirst({
			where: { investigationId: threadId, kind: "limit" },
			orderBy: { createdAt: "desc" },
			select: { state: true, payload: true },
		});
		const payload = parse(wake?.payload);
		const waking =
			wake?.state === "pending" ||
			(wake?.state === "skipped" &&
				(payload.gaveUp === true || payload.blocked === true));
		const last = await this.prisma.investigationEvent.findFirst({
			where: {
				foldedBy: null,
				investigationId: threadId,
				event: { contains: '"kind":"error"' },
			},
			orderBy: { seq: "desc" },
			select: { event: true },
		});
		const failure = RunFailureSchema.safeParse(parse(last?.event).failure);
		if (failure.success)
			return {
				mode: failure.data.mode,
				...(failure.data.window ? { window: failure.data.window } : {}),
			};
		const mode = modeOf(payload.mode);
		if (waking && mode)
			return {
				mode,
				...(windowOf(payload.window)
					? { window: windowOf(payload.window) }
					: {}),
			};
		return row.endReason === "limited"
			? { mode: "usage_limit" }
			: row.endReason === "blocked"
				? { mode: "out_of_credit" }
				: null;
	}

	/** Why a message to this thread waits now. */
	async waitReason(threadId: string): Promise<WaitReason> {
		const stop = await this.providerStop(threadId);
		if (stop) return { failure: stop };
		const row = await this.prisma.investigation.findUnique({
			where: { id: threadId },
			select: { status: true },
		});
		if (!row || isWorkflowTerminal(row.status))
			return { cause: row?.status === "cancelled" ? "stopped" : "ended" };
		return { cause: "busy" };
	}

	/** Tree messages queued for `threadId`, oldest first, as its agent reads them. */
	async queuedTree(
		threadId: string,
	): Promise<Array<{ id: string; text: string }>> {
		const rows = await this.prisma.threadMessage.findMany({
			where: { toId: threadId, state: "queued" },
			orderBy: { createdAt: "asc" },
		});
		const out: Array<{ id: string; text: string }> = [];
		for (const m of rows)
			out.push({ id: m.id, text: await treeMessageText(this.prisma, m) });
		return out;
	}

	/** Records one state of an incoming message on the thread; never throws. */
	async record(threadId: string, entry: InboundEntry): Promise<void> {
		const harness = (
			await this.prisma.investigation.findUnique({
				where: { id: threadId },
				select: { harness: true },
			})
		)?.harness;
		const agent = registryFacts(harness ?? null)?.label ?? harness ?? undefined;
		const body = {
			kind: "message_inbound" as const,
			messageId: entry.messageId,
			source: entry.source,
			state: entry.state,
			arrivedAt: entry.arrivedAt.toISOString(),
			...(entry.from ? { from: entry.from } : {}),
			text: entry.text.slice(0, 500),
			...(entry.failure ? { failure: entry.failure } : {}),
			...(entry.cause ? { cause: entry.cause } : {}),
			...(entry.prEvents ? { prEvents: entry.prEvents } : {}),
			...(entry.merged
				? {
						mergedInto: entry.merged.into,
						mergedAt: entry.merged.at.toISOString(),
					}
				: {}),
			line: inboundLine(entry.state, {
				...(entry.merged ? { merged: { at: entry.merged.at } } : {}),
				...(entry.failure ? { failure: entry.failure } : {}),
				...(entry.cause ? { cause: entry.cause } : {}),
				...(agent ? { agent } : {}),
			}),
		};
		// On the tree branch, so it never takes a seq the live run will use.
		for (let attempt = 0; attempt < 5; attempt++) {
			try {
				const event = {
					...body,
					runId: threadId,
					branchId: TREE_BRANCH,
					path: [],
					ts: clock.date().toISOString(),
					seq: (await this.investigations.lastEventSeq(threadId)) + 1,
				} as CanonicalEvent;
				const { inserted } = await this.investigations.appendEvents(threadId, [
					event,
				]);
				if (!inserted) continue;
				if (this.relay?.isActive(threadId)) this.relay.emit(threadId, event);
				return;
			} catch (e) {
				this.logger.warn(
					`Could not record an incoming message on ${threadId}: ${(e as Error).message}`,
				);
				return;
			}
		}
	}

	/** Records a waiting message's arrival once, with why it waits. */
	async arrived(
		threadId: string,
		entry: Omit<InboundEntry, "state" | "failure" | "cause">,
	): Promise<void> {
		const why = await this.waitReason(threadId);
		await this.record(threadId, { ...entry, state: "waiting", ...why });
	}

	/** Ends a waiting message that will never be delivered. */
	async failed(
		threadId: string,
		messageId: string,
		cause: WaitReason,
	): Promise<void> {
		const open = (await this.latest(threadId)).get(messageId);
		if (open?.state !== "waiting") return;
		await this.record(threadId, {
			...entryOf(open),
			state: "failed",
			...cause,
		});
	}

	/** Each message's latest state on this thread. */
	private async latest(threadId: string): Promise<Map<string, Inbound>> {
		const rows = await this.prisma.investigationEvent.findMany({
			where: {
				foldedBy: null,
				investigationId: threadId,
				event: { contains: '"kind":"message_inbound"' },
			},
			orderBy: { seq: "asc" },
			select: { event: true },
		});
		const map = new Map<string, Inbound>();
		for (const r of rows) {
			const e = parse(r.event) as Partial<Inbound>;
			if (e.kind === "message_inbound" && e.messageId)
				map.set(e.messageId, e as Inbound);
		}
		return map;
	}

	/**
	 * A message the agent took (its `operator_message`, or a resume that `delivers` it) reads
	 * delivered. A PR bundle reads delivered only on the receipt naming it, and merged only
	 * into a received bundle whose `supersedes` names it (#1179 OBJ-010).
	 */
	private async markDelivered(
		threadId: string,
		events: CanonicalEvent[],
	): Promise<void> {
		const ids = new Set<string>();
		const received = new Set<string>();
		for (const e of events) {
			if (e.kind === "operator_message" && e.delivered) {
				if (e.messageId) ids.add(e.messageId);
				for (const id of e.delivers ?? []) ids.add(id);
			}
			if (e.kind === "message_received")
				for (const id of e.messageIds) received.add(id);
		}
		if (!ids.size && !received.size) return;
		const open = await this.latest(threadId);
		const waiting = [...open].filter(([, e]) => e.state === "waiting");
		if (!waiting.length) return;
		const prWakes = new Set(
			(
				await this.prisma.threadWake.findMany({
					where: {
						id: { in: waiting.map(([id]) => id) },
						kind: "pr_status",
					},
					select: { id: true },
				})
			).map((w) => w.id),
		);
		// A cron fire carries every fire still pending, so it closes the rows of fires it replaced.
		const batches = await this.prisma.threadWake.findMany({
			where: { id: { in: [...ids] }, kind: "cron" },
			select: { id: true, kind: true, at: true },
		});
		const bundles = await this.prisma.threadWake.findMany({
			where: { id: { in: [...received] }, kind: "pr_status" },
			select: { id: true, at: true, payload: true },
		});
		for (const [id, e] of waiting) {
			if (prWakes.has(id)) {
				if (received.has(id)) {
					await this.record(threadId, { ...entryOf(e), state: "delivered" });
					continue;
				}
				const into = bundles.find((b) => supersedesOf(b.payload).includes(id));
				if (into)
					await this.record(threadId, {
						...entryOf(e),
						state: "delivered",
						merged: { into: into.id, at: into.at },
					});
				continue;
			}
			if (ids.has(id)) {
				await this.record(threadId, { ...entryOf(e), state: "delivered" });
				continue;
			}
			// Never delivered on its own: it reads as merged into the fire that carried it (#1101).
			const into = batches.find(
				(w) => wakeSource(w.kind as WakeKind) === e.source,
			);
			if (into)
				await this.record(threadId, {
					...entryOf(e),
					state: "delivered",
					merged: { into: into.id, at: into.at },
				});
		}
	}
}

function entryOf(e: Inbound): Omit<InboundEntry, "state"> {
	return {
		messageId: e.messageId,
		source: e.source,
		arrivedAt: new Date(e.arrivedAt),
		text: e.text,
		...(e.from ? { from: e.from } : {}),
		...(e.prEvents ? { prEvents: e.prEvents } : {}),
	};
}

/** The wakes a PR bundle replaced, from its payload (#1179 OBJ-024). */
function supersedesOf(raw: string | null): string[] {
	const s = parse(raw).supersedes;
	return Array.isArray(s)
		? s.filter((x): x is string => typeof x === "string")
		: [];
}

function parse(text: string | null | undefined): Record<string, unknown> {
	try {
		const v: unknown = text ? JSON.parse(text) : {};
		return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}
