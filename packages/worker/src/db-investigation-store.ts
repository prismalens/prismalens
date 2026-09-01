// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * DB-backed {@link InvestigationStore} adapter (ADR-0018) — folds the worker's
 * investigation lifecycle (status + timeline + result persistence) into the
 * conductor's create → append → finish|fail ordering.
 *
 * `append` is no longer a no-op (B.4): it BUFFERS each canonical event and flushes
 * BATCHED (≥25 events, or 1s after the first buffered event — whichever comes first)
 * to the API's internal bulk-append endpoint, giving every run a durable server-side
 * event record (the gap the retired AgentExecution rows left). The live SSE path is
 * untouched — that still rides the IPC sink to the host's EventBus (see the
 * conductor's SINK port).
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
import type { ContractRouterClient } from "@orpc/contract";
import type {
	CanonicalEvent,
	Contract,
	InvestigationReport,
} from "@prismalens/contracts";
import type { InvestigationStore } from "@prismalens/engine";
import { Logger } from "@prismalens/logger";
import { internalUrl } from "./internal-url.js";

/** Flush when the buffer reaches this many events. */
const BATCH_SIZE = 25;

/** Flush at most this long after the first event lands in an empty buffer. */
const FLUSH_INTERVAL_MS = 1_000;

/** Per-flush HTTP timeout — a wedged API must not stall the run. */
const FLUSH_TIMEOUT_MS = 10_000;

const logger = new Logger({ context: "DbInvestigationStore" });

export interface DbInvestigationStoreParams {
	investigationId: string;
	incidentId: string;
	runId: string;
	/** Base URL of the API, for the internal bulk-append endpoint. */
	apiBaseUrl: string;
	/**
	 * The internal-endpoint secret (X-Internal-Secret). When absent, the default
	 * poster throws → every flush drops (durable record disabled), never failing the
	 * run.
	 */
	internalSecret?: string;
	/**
	 * Test seam: override the batch poster. Defaults to a `fetch` POST to
	 * `/internal/investigations/:id/events`. Injected in tests to assert the batching
	 * behaviour without touching the network.
	 */
	appendEvents?: (events: CanonicalEvent[]) => Promise<void>;
	/** Test seam: override status updater (#535). Defaults to internal PATCH. */
	updateStatus?: (dto: {
		status: "running" | "failed" | "completed" | "cancelled";
		error?: string;
		harnessThreadId?: string;
		startedAt?: string;
	}) => Promise<void>;
	/** Test seam: override timeline creator (#535). Defaults to internal POST. */
	createTimeline?: (dto: {
		incidentId: string;
		type: string;
		title: string;
		description?: string;
		source?: string;
		metadata?: Record<string, unknown>;
	}) => Promise<void>;
}

/**
 * Build the default batch poster: a `fetch` POST of the events to the API's internal
 * bulk-append endpoint (X-Internal-Secret pattern, mirroring the worker's LLM-config
 * fetch). Throws on a missing secret or a non-2xx response so the store's flush
 * counts the batch as dropped.
 */
function createEventPoster(
	apiBaseUrl: string,
	internalSecret: string | undefined,
	investigationId: string,
): (events: CanonicalEvent[]) => Promise<void> {
	return async (events) => {
		if (!internalSecret) {
			throw new Error(
				"PRISMALENS_INTERNAL_SECRET not set — durable event record disabled",
			);
		}
		const url = internalUrl(
			apiBaseUrl,
			`internal/investigations/${investigationId}/events`,
		);
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Internal-Secret": internalSecret,
				"User-Agent": "prismalens-worker/0.1.0",
			},
			body: JSON.stringify({ events }),
			signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
		});
		if (!response.ok) {
			throw new Error(
				`bulk-append failed: ${response.status} ${response.statusText}`,
			);
		}
	};
}

/**
 * Fetch investigation record via the internal API endpoint (#537).
 * Public route is session-guarded; worker uses X-Internal-Secret.
 */
export async function fetchInvestigation(
	apiBaseUrl: string,
	internalSecret: string | undefined,
	investigationId: string,
): Promise<{ id: string; status: string; [key: string]: unknown }> {
	if (!internalSecret) {
		throw new Error(
			"PRISMALENS_INTERNAL_SECRET not set — cannot check investigation status",
		);
	}
	const url = internalUrl(
		apiBaseUrl,
		`internal/investigations/${investigationId}`,
	);
	const response = await fetch(url, {
		method: "GET",
		headers: {
			"X-Internal-Secret": internalSecret,
			"User-Agent": "prismalens-worker/0.1.0",
		},
		signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(
			`fetch-investigation failed: ${response.status} ${response.statusText} — ${body}`,
		);
	}
	return response.json() as Promise<{
		id: string;
		status: string;
		[key: string]: unknown;
	}>;
}

/**
 * Update investigation status via the internal API endpoint (#535).
 * Public route is session-guarded; worker uses X-Internal-Secret.
 */
export async function updateInvestigationStatus(
	apiBaseUrl: string,
	internalSecret: string | undefined,
	investigationId: string,
	dto: {
		status: "running" | "failed" | "completed" | "cancelled";
		error?: string;
		harnessThreadId?: string;
		startedAt?: string;
	},
): Promise<void> {
	if (!internalSecret) {
		throw new Error(
			"PRISMALENS_INTERNAL_SECRET not set — cannot update investigation status",
		);
	}
	const url = internalUrl(
		apiBaseUrl,
		`internal/investigations/${investigationId}/status`,
	);
	const response = await fetch(url, {
		method: "PATCH",
		headers: {
			"Content-Type": "application/json",
			"X-Internal-Secret": internalSecret,
			"User-Agent": "prismalens-worker/0.1.0",
		},
		body: JSON.stringify(dto),
		signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(
			`update-status failed: ${response.status} ${response.statusText} — ${body}`,
		);
	}
}

/**
 * Create a timeline entry via the internal API endpoint (#535).
 * Public route is session-guarded; worker uses X-Internal-Secret.
 */
export async function createTimelineEntry(
	apiBaseUrl: string,
	internalSecret: string | undefined,
	dto: {
		incidentId: string;
		type: string;
		title: string;
		description?: string;
		source?: string;
		metadata?: Record<string, unknown>;
	},
): Promise<void> {
	if (!internalSecret) {
		throw new Error(
			"PRISMALENS_INTERNAL_SECRET not set — cannot create timeline entry",
		);
	}
	const url = internalUrl(apiBaseUrl, "internal/timeline");
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Internal-Secret": internalSecret,
			"User-Agent": "prismalens-worker/0.1.0",
		},
		body: JSON.stringify(dto),
		signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(
			`create-timeline failed: ${response.status} ${response.statusText} — ${body}`,
		);
	}
}

export function createDbInvestigationStore(
	api: ContractRouterClient<Contract>,
	{
		investigationId,
		incidentId,
		runId,
		apiBaseUrl,
		internalSecret,
		appendEvents,
		updateStatus,
		createTimeline,
	}: DbInvestigationStoreParams,
): InvestigationStore {
	const post =
		appendEvents ??
		createEventPoster(apiBaseUrl, internalSecret, investigationId);
	const patchStatus =
		updateStatus ??
		((dto: {
			status: "running" | "failed" | "completed" | "cancelled";
			error?: string;
			harnessThreadId?: string;
			startedAt?: string;
		}) =>
			updateInvestigationStatus(
				apiBaseUrl,
				internalSecret,
				investigationId,
				dto,
			));
	const postTimeline =
		createTimeline ??
		((dto: {
			incidentId: string;
			type: string;
			title: string;
			description?: string;
			source?: string;
			metadata?: Record<string, unknown>;
		}) => createTimelineEntry(apiBaseUrl, internalSecret, dto));

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
	// triggers never double-send), POST it, and on failure log + drop + count.
	const doFlush = async (): Promise<void> => {
		if (buffer.length === 0) return;
		const batch = buffer;
		buffer = [];
		try {
			await post(batch);
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
			await patchStatus({
				status: "running",
				harnessThreadId: runId,
			});
			await postTimeline({
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
				// Don't let a pending durability flush hold the worker's event loop open.
				flushTimer.unref?.();
			}
		},

		async finish(report: InvestigationReport) {
			// Drain the durable record (incl. the buffered terminal `report` event)
			// BEFORE the status write, then persist the result. writeResult ONLY on
			// success — matches the pre-conductor worker (no "completed" timeline entry
			// on success; only the started + failed entries).
			await flush();
			if (dropped > 0) {
				logger.warn(
					`Durable event record for investigation ${investigationId} dropped ${dropped} event(s) total`,
				);
			}
			await api.investigations.writeResult({
				id: investigationId,
				status: "completed",
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
			await patchStatus({
				status: "failed",
				error,
			});
			await postTimeline({
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
