// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { useEffect, useRef, useState } from "react";
import { agentStepMessage } from "@/lib/investigation-events";

interface StreamState {
	events: CanonicalEvent[];
	status:
		| "idle"
		| "connecting"
		| "streaming"
		| "completed"
		| "failed"
		| "error";
	/** Latest agent "thinking" text, for the header summary line. */
	latestText: string | null;
}

const INITIAL_STATE: StreamState = {
	events: [],
	status: "idle",
	latestText: null,
};

/** A hidden tab runs no animation frames; queued events still land this often. */
export const HIDDEN_FLUSH_MS = 100;

/** The terminal control marker the SSE controller sends after the last event. */
type DoneMarker = { type: "done" };

/** The state after a batch of events, in arrival order. */
export function applyEvents(
	prev: StreamState,
	batch: readonly CanonicalEvent[],
): StreamState {
	let status = prev.status;
	let latestText = prev.latestText;
	for (const event of batch) {
		status = event.kind === "report" ? "completed" : "streaming";
		if (event.kind === "agent_step" && event.text.trim())
			latestText = agentStepMessage(event.text.trim());
	}
	return { events: [...prev.events, ...batch], status, latestText };
}

/**
 * SSE hook for real-time investigation stream events (ADR-0008 canonical stream).
 *
 * Connects to GET /api/investigations/:id/stream and receives `CanonicalEvent`s
 * (kind-tagged: agent_step / tool_result / branch_done / error / report), then a
 * final `{ type: "done" }` marker. Events queue and apply once per animation
 * frame (#874); `done` and a dropped stream apply the queue first.
 *
 * @param investigationId Investigation ID to stream
 * @param options.enabled Whether to enable the SSE connection (default: false)
 */
export function useInvestigationStream(
	investigationId: string,
	options?: { enabled?: boolean },
) {
	const [state, setState] = useState<StreamState>(INITIAL_STATE);
	const sourceRef = useRef<EventSource | null>(null);

	useEffect(() => {
		if (!options?.enabled || !investigationId) {
			return;
		}

		let hadError = false;
		const queue: CanonicalEvent[] = [];
		let frame: number | undefined;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const flush = () => {
			if (frame !== undefined) cancelAnimationFrame(frame);
			clearTimeout(timeout);
			frame = undefined;
			timeout = undefined;
			if (queue.length === 0) return;
			const batch = queue.splice(0);
			setState((prev) => applyEvents(prev, batch));
		};
		const schedule = () => {
			if (frame !== undefined || timeout !== undefined) return;
			frame = requestAnimationFrame(flush);
			timeout = setTimeout(flush, HIDDEN_FLUSH_MS);
		};

		// A new subscription is a new run's stream: anything already in state
		// belongs to the investigation just navigated away from (#280).
		setState({ ...INITIAL_STATE, status: "connecting" });

		const source = new EventSource(
			`/api/investigations/${investigationId}/stream`,
		);
		sourceRef.current = source;

		source.onmessage = (e) => {
			try {
				const parsed = JSON.parse(e.data) as CanonicalEvent | DoneMarker;

				// Terminal marker: the stream ended cleanly.
				if ("type" in parsed && parsed.type === "done") {
					flush();
					setState((prev) => ({
						...prev,
						status: hadError ? "failed" : "completed",
					}));
					source.close();
					return;
				}

				const event = parsed as CanonicalEvent;
				if (event.kind === "error") {
					hadError = true;
				}
				queue.push(event);
				schedule();
			} catch {
				// Ignore parse errors
			}
		};

		source.onerror = () => {
			flush();
			setState((prev) => ({ ...prev, status: "error" }));
			source.close();
		};

		return () => {
			if (frame !== undefined) cancelAnimationFrame(frame);
			clearTimeout(timeout);
			source.close();
			sourceRef.current = null;
		};
	}, [investigationId, options?.enabled]);

	return state;
}
