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
import type { CanonicalEvent, InvestigationReport } from "@prismalens/contracts";
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
}

export function createPrismaInvestigationStore(
	ports: RunPorts,
	{ investigationId, incidentId, runId }: PrismaInvestigationStoreParams,
): InvestigationStore {
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
		async create() {
			await ports.updateStatus(investigationId, {
				status: "running",
				harnessThreadId: runId,
			});
			await ports.createTimelineEntry({
				incidentId,
				type: "investigation_started",
				title: "AI Investigation Started",
				description: "Starting the two-tier engine investigation",
				source: "ai_worker",
				metadata: { investigationId },
			});
		},

		async append(event: CanonicalEvent) {
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

		async finish(report: InvestigationReport) {
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
			await ports.writeResult(investigationId, {
				status: "completed",
				incidentId,
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
			});
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
			await ports.updateStatus(investigationId, {
				status: "failed",
				error,
			});
			await ports.createTimelineEntry({
				incidentId,
				type: "investigation_completed",
				title: "AI Investigation Failed",
				description: error,
				source: "ai_worker",
				metadata: { investigationId, error },
			});
		},
	};
}
