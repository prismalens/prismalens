import { useEffect, useRef, useState } from "react";

/** Raw LangGraph stream tuple: [mode, data] */
export type StreamTuple = [string, unknown];

/** Maximum number of tuples to keep in state for rendering */
const MAX_TUPLES = 200;

interface StreamState {
	tuples: StreamTuple[];
	status: "idle" | "connecting" | "streaming" | "completed" | "error";
	currentNode: string | null;
	latestMessage: string | null;
}

const INITIAL_STATE: StreamState = {
	tuples: [],
	status: "idle",
	currentNode: null,
	latestMessage: null,
};

/**
 * SSE hook for real-time investigation stream events.
 *
 * Connects to GET /api/investigations/:id/stream and receives
 * raw LangGraph [mode, data] tuples.
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
				const tuple = JSON.parse(e.data) as StreamTuple;
				const [mode, data] = tuple;

				// "__done__" sentinel means the stream is complete
				if (mode === "__done__") {
					setState((prev) => ({ ...prev, status: "completed" }));
					source.close();
					return;
				}

				setState((prev) => {
					const d = data as Record<string, unknown>;
					const newTuples = [...prev.tuples, tuple];
					return {
						tuples:
							newTuples.length > MAX_TUPLES
								? newTuples.slice(-MAX_TUPLES)
								: newTuples,
						status: "streaming",
						// "tasks" mode: { name: "scout", ... } — node starting/finishing
						currentNode:
							mode === "tasks" && d.name
								? (d.name as string)
								: prev.currentNode,
						// "custom" mode: { type: "progress", message: "..." }
						latestMessage:
							mode === "custom" && d.type === "progress"
								? (d.message as string)
								: prev.latestMessage,
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
