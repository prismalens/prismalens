// Core types for the M1 thin-loop spike.
//
// The LOOP owns orchestration (ADR-0003). Its only model dependency is a
// `ModelBackend` (ADR-0004); tools are plain functions. The report uses ordered
// hypotheses + evidence status, with NO numeric confidence (ADR-0002).

export type Role = "user" | "model";

/** One turn in the conversation the loop maintains. */
export interface Message {
	role: Role;
	/** Free text (optional on a model turn that only emits tool calls). */
	text?: string;
	/** Tool calls the model emitted (model turns only). */
	toolCalls?: ToolCall[];
	/** Results of prior tool calls, carried back on a user turn. */
	toolResults?: ToolResult[];
}

export interface ToolCall {
	/** Id we assign so a result can be matched back to its call. */
	id: string;
	name: string;
	args: Record<string, unknown>;
}

export interface ToolResult {
	id: string;
	name: string;
	/** Already truncated/sanitized tool output. */
	output: string;
	isError?: boolean;
}

/** A JSON-schema subset both Gemini and Ollama accept for tool params. */
export interface ToolParameter {
	type: "object" | "array" | "string" | "number" | "integer" | "boolean";
	description?: string;
	items?: ToolParameter;
	properties?: Record<string, ToolParameter>;
	required?: string[];
	enum?: string[];
}

export interface ToolDef {
	name: string;
	description: string;
	/** Always an object schema at the top level. */
	parameters: ToolParameter;
}

export interface ModelResponse {
	text: string;
	toolCalls: ToolCall[];
}

/** The single seam between our loop and any model/provider (ADR-0004). */
export interface ModelBackend {
	readonly id: string;
	complete(
		system: string,
		messages: Message[],
		tools: ToolDef[],
	): Promise<ModelResponse>;
}

// ---- Report contract (ADR-0002) — ordered hypotheses + evidence status, NO confidence number ----

export type EvidenceStatus = "verified" | "inferred";
export type EvidenceDirection = "supports" | "contradicts";

export interface Evidence {
	/** What was observed. */
	observation: string;
	/** Where it came from (e.g. the exact command that produced it). */
	source: string;
	direction: EvidenceDirection;
	/** verified = a tool directly showed it; inferred = reasoned, not directly observed. */
	status: EvidenceStatus;
}

export interface Hypothesis {
	/** 1 = most likely. Ordering REPLACES a numeric confidence score. */
	rank: number;
	statement: string;
	evidence: Evidence[];
}

export interface Recommendation {
	title: string;
	detail: string;
}

export interface Report {
	summary: string;
	rootCause: string | null;
	hypotheses: Hypothesis[];
	recommendations: Recommendation[];
}

// ---- Loop telemetry (forward-looking to the visual UI, ADR-0007; M1 just prints it) ----

export type StepEvent =
	| { kind: "model_turn"; step: number; text: string; toolCalls: { name: string; args: Record<string, unknown> }[] }
	| { kind: "tool_result"; step: number; name: string; ok: boolean; preview: string }
	| { kind: "done"; step: number; reason: "submitted" | "budget" | "no_progress" }
	| { kind: "report"; report: Report };

export type EventSink = (event: StepEvent) => void;
