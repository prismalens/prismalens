import { useEffect, useRef, useState } from "react";

/**
 * SSE hook for the in-process @prismalens/engine investigation stream.
 *
 * The engine emits StepEvents that the API relays over the SSE endpoint as
 * `[kind, payload]` tuples (plus an `["error", { message }]` tuple on failure and the
 * shared `["__done__", {}]` sentinel). This hook reduces that stream into a structured
 * step timeline + the final ordered-evidence report for the drill-down UI (ADR-0007).
 *
 * The engine package is server-only (it shells out), so its types are mirrored here
 * rather than imported — only the wire shape crosses to the browser.
 */

export interface EngineEvidence {
	observation: string;
	source: string;
	direction: "supports" | "contradicts";
	status: "verified" | "inferred";
}

export interface EngineHypothesis {
	rank: number;
	statement: string;
	evidence: EngineEvidence[];
}

export interface EngineRecommendation {
	title: string;
	detail: string;
}

export interface EngineReport {
	summary: string;
	rootCause: string | null;
	hypotheses: EngineHypothesis[];
	recommendations: EngineRecommendation[];
}

export interface EngineToolCall {
	name: string;
	args: Record<string, unknown>;
}

export interface EngineToolResult {
	name: string;
	ok: boolean;
	preview: string;
}

/** One investigation step: a model turn and the results of the tools it called. */
export interface EngineStep {
	step: number;
	text: string;
	toolCalls: EngineToolCall[];
	results: EngineToolResult[];
}

export type EngineStreamStatus =
	| "idle"
	| "connecting"
	| "streaming"
	| "completed"
	| "error";

export interface EngineStreamState {
	steps: EngineStep[];
	report: EngineReport | null;
	status: EngineStreamStatus;
	error: string | null;
}

const INITIAL_STATE: EngineStreamState = {
	steps: [],
	report: null,
	status: "idle",
	error: null,
};

type StreamTuple = [string, unknown];

export function useEngineInvestigationStream(
	investigationId: string,
	options?: { enabled?: boolean },
): EngineStreamState {
	const [state, setState] = useState<EngineStreamState>(INITIAL_STATE);
	const sourceRef = useRef<EventSource | null>(null);

	useEffect(() => {
		if (!options?.enabled || !investigationId) {
			return;
		}

		setState({ ...INITIAL_STATE, status: "connecting" });

		const source = new EventSource(
			`/api/investigations/${investigationId}/stream`,
		);
		sourceRef.current = source;

		source.onmessage = (e) => {
			let tuple: StreamTuple;
			try {
				tuple = JSON.parse(e.data) as StreamTuple;
			} catch {
				return;
			}
			const [kind, payload] = tuple;

			if (kind === "__done__") {
				setState((prev) => ({
					...prev,
					status: prev.status === "error" ? "error" : "completed",
				}));
				source.close();
				return;
			}

			if (kind === "error") {
				const message =
					(payload as { message?: string })?.message ?? "Investigation failed";
				setState((prev) => ({ ...prev, status: "error", error: message }));
				return;
			}

			setState((prev) => reduceEvent(prev, kind, payload));
		};

		source.onerror = () => {
			setState((prev) =>
				prev.status === "completed"
					? prev
					: {
							...prev,
							status: "error",
							error: prev.error ?? "Stream connection lost",
						},
			);
			source.close();
		};

		return () => {
			source.close();
			sourceRef.current = null;
		};
	}, [investigationId, options?.enabled]);

	return state;
}

function reduceEvent(
	state: EngineStreamState,
	kind: string,
	payload: unknown,
): EngineStreamState {
	switch (kind) {
		case "model_turn": {
			const ev = payload as {
				step: number;
				text?: string;
				toolCalls?: EngineToolCall[];
			};
			return {
				...state,
				status: "streaming",
				steps: [
					...state.steps,
					{
						step: ev.step,
						text: ev.text ?? "",
						toolCalls: ev.toolCalls ?? [],
						results: [],
					},
				],
			};
		}
		case "tool_result": {
			const ev = payload as {
				step: number;
				name: string;
				ok: boolean;
				preview: string;
			};
			const result: EngineToolResult = {
				name: ev.name,
				ok: ev.ok,
				preview: ev.preview,
			};
			const steps = state.steps.slice();
			// Attach to the most recent step with a matching number.
			for (let i = steps.length - 1; i >= 0; i--) {
				if (steps[i].step === ev.step) {
					steps[i] = { ...steps[i], results: [...steps[i].results, result] };
					return { ...state, status: "streaming", steps };
				}
			}
			steps.push({ step: ev.step, text: "", toolCalls: [], results: [result] });
			return { ...state, status: "streaming", steps };
		}
		case "report": {
			const ev = payload as { report?: EngineReport };
			return { ...state, report: ev.report ?? null };
		}
		default:
			// "done" and any unknown tags carry no UI state of their own.
			return state;
	}
}
