import type { CanonicalEvent } from "@prismalens/contracts";
import { useEffect, useRef, useState } from "react";

/** Maximum number of canonical events to keep in state for rendering */
const MAX_EVENTS = 200;

interface StreamState {
	events: CanonicalEvent[];
	status: "idle" | "connecting" | "streaming" | "completed" | "error";
	/** Latest agent "thinking" text, for the header summary line. */
	latestText: string | null;
}

const INITIAL_STATE: StreamState = {
	events: [],
	status: "idle",
	latestText: null,
};

/** The terminal control marker the SSE controller sends after the last event. */
type DoneMarker = { type: "done" };

/**
 * SSE hook for real-time investigation stream events (ADR-0008 canonical stream).
 *
 * Connects to GET /api/investigations/:id/stream and receives `CanonicalEvent`s
 * (kind-tagged: agent_step / tool_result / branch_done / error / report), then a
 * final `{ type: "done" }` marker. Supersedes the old LangGraph `[mode, data]` parse.
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

		setState((prev) => ({ ...prev, status: "connecting" }));

		const source = new EventSource(
			`/api/investigations/${investigationId}/stream`,
		);
		sourceRef.current = source;

		source.onmessage = (e) => {
			try {
				const parsed = JSON.parse(e.data) as CanonicalEvent | DoneMarker;

				// Terminal marker — the stream ended cleanly.
				if ("type" in parsed && parsed.type === "done") {
					setState((prev) => ({
						...prev,
						status: prev.status === "error" ? "error" : "completed",
					}));
					source.close();
					return;
				}

				const event = parsed as CanonicalEvent;
				setState((prev) => {
					const events = [...prev.events, event];
					return {
						events:
							events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events,
						status:
							event.kind === "report"
								? "completed"
								: event.kind === "error"
									? "error"
									: "streaming",
						latestText:
							event.kind === "agent_step" && event.text.trim()
								? event.text.trim()
								: prev.latestText,
					};
				});
			} catch {
				// Ignore parse errors
			}
		};

		source.onerror = () => {
			setState((prev) => ({ ...prev, status: "error" }));
			source.close();
		};

		return () => {
			source.close();
			sourceRef.current = null;
		};
	}, [investigationId, options?.enabled]);

	return state;
}
