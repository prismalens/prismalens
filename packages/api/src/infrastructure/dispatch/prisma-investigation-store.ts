// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * DB-backed {@link InvestigationStore} adapter (ADR-0018) — folds the run's
 * investigation lifecycle (status + timeline + result persistence) into the
 * conductor's create → append → finish|fail ordering, through {@link RunPorts}
 * instead of the internal HTTP surface the forked worker used to call.
 *
 * `append` BUFFERS each canonical event and flushes BATCHED (≥25 events, or 1s
 * after the first buffered event — whichever comes first) through
 * `ports.appendEvents`, giving every run a durable server-side event record.
 * The live SSE path is untouched — that still rides the in-process sink to the
 * dispatch loop's EventBus (see the conductor's SINK port).
 *
 * Durability is BEST-EFFORT and must NEVER fail the run (mirrors the overlay's
 * fire-and-forget posture): a flush failure logs, DROPS the batch, and counts the
 * dropped events — it never throws. The terminal events (the report / error that the
 * conductor buffers via `append` before calling `finish`/`fail`) are drained by a
 * synchronous flush at the TOP of `finish`/`fail`, before the status/result writes,
 * so the durable record is complete when the row flips terminal. The conductor's
 * `cancelled` outcome calls neither finish nor fail, so it invokes {@link flush}
 * directly to drain the same buffered tail before it resolves.
 */
import type {
	CanonicalEvent,
	InvestigationReport,
	LiveTurn,
} from "@prismalens/contracts";
import type { InvestigationStore } from "@prismalens/engine";
import { Logger } from "@prismalens/logger";
import type { RunPorts } from "./run-ports.js";

/** Flush when the buffer reaches this many events. */
const BATCH_SIZE = 25;

/** Flush at most this long after the first event lands in an empty buffer. */
const FLUSH_INTERVAL_MS = 1_000;

const logger = new Logger({ context: "PrismaInvestigationStore" });

export interface PrismaInvestigationStoreParams {
	investigationId: string;
	incidentId: string;
	runId: string;
	harness?: string;
	model?: string;
	/** The effort it asked for, kept so a follow-up asks again (#673 w52). */
	effort?: string;
	/** JSON RunWorkspace, kept on the row so a follow-up can rebuild it (#747). */
	workspace?: string;
	/** The agent's own mode id the run asked for, kept so a follow-up runs in it (#673 w21). */
	agentMode?: string;
	/**
	 * A follow-up (#747): the row only goes live, the timeline says resumed with
	 * this note, and nothing is written at the end; the run settles the row.
	 * `continuing` (R4.4): the end is written as a run's would be.
	 */
	resume?: { note: string; continuing?: boolean };
	/** A chat (#673): its timeline says Chat, and its first turn finishes with no report. */
	chat?: boolean;
}

/**
 * What a claimed job owes, read from its payload (#673 w59, OBJ-021): a
 * chat or an Ask answers, a first investigation or a `continue` reports.
 */
export function payloadTurn(
	params: Pick<PrismaInvestigationStoreParams, "chat" | "resume">,
): LiveTurn {
	if (params.chat) return "answer";
	if (params.resume) return params.resume.continuing ? "report" : "answer";
	return "report";
}

/** The store, plus whether its terminal write was refused (#673 w59). */
export type PrismaInvestigationStore = InvestigationStore & {
	/** True once finish or fail wrote an end the row refused (Stop asked for, cancelled). */
	refused(): boolean;
	/** A follow-up's message reached the agent: the engine marks it delivered just before the prompt. */
	delivered(): boolean;
};

export function createPrismaInvestigationStore(
	ports: RunPorts,
	{
		investigationId,
		incidentId,
		runId,
		harness,
		model,
		effort,
		workspace,
		agentMode,
		resume,
		chat,
	}: PrismaInvestigationStoreParams,
): PrismaInvestigationStore {
	let refused = false;
	let delivered = false;
	let buffer: CanonicalEvent[] = [];
	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	// Flushes are chained so a terminal flush awaits any in-flight one — the report
	// event is durably persisted BEFORE the terminal status write, never racing it.
	let flushChain: Promise<void> = Promise.resolve();
	let dropped = 0;

	const clearFlushTimer = () => {
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
	};

	// One flush attempt: take the whole buffer synchronously (so overlapping
	// triggers never double-send), append it, and on failure log + drop + count.
	const doFlush = async (): Promise<void> => {
		if (buffer.length === 0) return;
		const batch = buffer;
		buffer = [];
		try {
			await ports.appendEvents(investigationId, batch);
		} catch (err) {
			dropped += batch.length;
			const message = String(
				(err as { message?: unknown } | null)?.message ?? err,
			);
			logger.warn(
				`Durable event flush dropped ${batch.length} event(s) for investigation ${investigationId}: ${message}`,
			);
		}
	};

	// Schedule a flush onto the serial chain and cancel any pending timer. Returns
	// the chain tail, so awaiting it awaits every prior flush too.
	const flush = (): Promise<void> => {
		clearFlushTimer();
		flushChain = flushChain.then(doFlush);
		return flushChain;
	};

	return {
		refused: () => refused,
		delivered: () => delivered,

		async create() {
			const turn = payloadTurn({ chat, resume });
			if (resume) {
				await ports.followUpStatus(investigationId, { status: "running" });
				await ports.initLiveTurn(investigationId, turn);
				await ports.createTimelineEntry({
					incidentId,
					type: "investigation_started",
					title: chat ? "Chat resumed" : "Investigation resumed",
					description: resume.note,
					source: "ai_worker",
					metadata: { investigationId },
				});
				return;
			}
			await ports.updateStatus(investigationId, {
				status: "running",
				harnessThreadId: runId,
				...(harness ? { harness } : {}),
				...(model ? { model } : {}),
				...(effort ? { effort } : {}),
				...(workspace ? { workspace } : {}),
				...(agentMode ? { agentMode } : {}),
			});
			await ports.initLiveTurn(investigationId, turn);
			await ports.createTimelineEntry({
				incidentId,
				type: "investigation_started",
				title: chat ? "Chat started" : "Agent started",
				description: chat
					? "The agent is answering your message."
					: "The agent is reading the incident.",
				source: "ai_worker",
				metadata: { investigationId },
			});
		},

		async append(event: CanonicalEvent) {
			if (event.kind === "operator_message" && event.delivered)
				delivered = true;
			buffer.push(event);
			if (buffer.length >= BATCH_SIZE) {
				await flush();
			} else if (!flushTimer) {
				flushTimer = setTimeout(() => {
					void flush();
				}, FLUSH_INTERVAL_MS);
				// Don't let a pending durability flush hold the event loop open.
				flushTimer.unref?.();
			}
		},

		async finish(report: InvestigationReport | null) {
			// Drain the durable record (incl. the buffered terminal `report` event)
			// BEFORE the status write, then persist the result. writeResult ONLY on
			// success — no "completed" timeline entry on success; only the started +
			// failed entries.
			await flush();
			if (dropped > 0) {
				logger.warn(
					`Durable event record for investigation ${investigationId} dropped ${dropped} event(s) total`,
				);
			}
			// A follow-up that never reached its agent is put back by the run (X1, #804 OBJ-026).
			if (resume && !(resume.continuing && delivered)) return;
			// A chat ends its turn with no report; the row completes all the same (#673).
			if (!report) {
				refused = !(await ports.writeResult(investigationId, {
					status: "completed",
					incidentId,
				}));
				return;
			}
			refused = !(await ports.writeResult(investigationId, {
				status: "completed",
				incidentId,
				...(resume?.continuing ? { lastTurnOutcome: "answered" as const } : {}),
				summary: report.summary,
				rootCause: report.rootCause ?? undefined,
				rootCauseCategory: report.rootCauseCategory ?? undefined,
				report,
				recommendations: report.nextSteps.map((step) => ({
					title: step.title,
					description: step.detail,
					priority: step.priority ?? undefined,
					category: "investigation",
					actionable: true,
				})),
			}));
		},

		async flush() {
			// Synchronous drain for the conductor's cancelled path (which calls neither
			// finish nor fail): push the buffered tail — incl. the terminal CANCELLED
			// `error` event — out now, so a cancelled run's durable record is complete
			// instead of stranded on the unref'd timer. Reuses the same serial flush the
			// timer/size triggers use, so it can never double-send a batch (doFlush takes
			// the whole buffer synchronously).
			await flush();
		},

		async fail(error: string) {
			await flush();
			if (dropped > 0) {
				logger.warn(
					`Durable event record for investigation ${investigationId} dropped ${dropped} event(s) total`,
				);
			}
			if (resume && !(resume.continuing && delivered)) return;
			const applied = await ports.updateStatus(investigationId, {
				status: "failed",
				error,
				...(resume?.continuing ? { lastTurnOutcome: "error" as const } : {}),
			});
			// A refused write (Stop asked for) leaves the end to the run (#673 w59).
			refused = !applied;
			if (!applied) return;
			await ports.createTimelineEntry({
				incidentId,
				type: "investigation_completed",
				title: chat ? "Chat error" : "Investigation failed",
				description: error,
				source: "ai_worker",
				metadata: { investigationId, error },
			});
		},
	};
}
