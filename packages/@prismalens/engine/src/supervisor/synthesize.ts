/**
 * Synthesize — the Tier-1 reduce step (ADR-0008): turn a branch's investigation
 * transcript into the structured ordered-evidence report (ADR-0002). This is the
 * only LLM call the supervisor itself makes in Phase-1 (decompose is N=1), via the
 * Vercel AI SDK (provider-agnostic, BYO-key) — NOT the rented harness.
 *
 * Robustness: try the SDK's structured-object path first; if the (BYO, possibly
 * OpenAI-compat) endpoint can't honour the JSON-schema constraint, fall back to a
 * plain completion + manual extraction, and validate the result against
 * `InvestigationReportSchema` either way (AGENTS.md gate 1: validate at the boundary).
 */
import type { LLMProviderId } from "@prismalens/config/llm";
import { resolveModel } from "@prismalens/config/model";
import {
	type InvestigationReport,
	InvestigationReportSchema,
} from "@prismalens/contracts";
import { generateObject, generateText } from "ai";

export interface SynthesisModelConfig {
	/** LLM provider the reduce step calls, resolved via ADR-0013's resolveModel. */
	providerId: LLMProviderId;
	/** Model id, e.g. "gpt-oss:20b" or "claude-sonnet-4-5". */
	model: string;
	/** BYO-key, injected by the caller (ADR-0006); omit for keyless local. */
	apiKey?: string;
	/** Required for the OpenAI-compatible providers (ollama/custom). */
	baseURL?: string;
}

const SYSTEM = `You are a senior Site Reliability Engineer writing the FINAL structured root-cause report for an incident investigation.

Epistemics (strict): order hypotheses MOST → LEAST plausible by array position. Do NOT use numeric confidence/probability. Each hypothesis carries a discrete status and a list of evidence; each evidence item records what was observed, the exact source (the command/metric/file that produced it), whether it supports or contradicts, and whether it was directly verified or inferred. Ground every claim in the transcript — do not invent evidence.`;

const SHAPE_HINT = `{
  "summary": string,
  "rootCause": string | null,
  "rootCauseCategory": "code" | "config" | "infrastructure" | "external" | "unknown" | null,
  "hypotheses": [ { "statement": string, "status": "confirmed" | "supported" | "speculative" | "refuted", "evidence": [ { "observation": string, "source": string, "direction": "supports" | "contradicts", "status": "verified" | "inferred" } ] } ],
  "ruledOut": [ { "statement": string, "why": string, "evidence": [ { "observation": string, "source": string, "direction": "supports" | "contradicts", "status": "verified" | "inferred" } ] } ],
  "coverage": { "queried": string[], "notQueried": string[] },
  "nextSteps": [ { "title": string, "detail": string, "priority": "critical" | "high" | "medium" | "low" | null } ]
}`;

export async function synthesizeReport(
	transcript: string,
	cfg: SynthesisModelConfig,
): Promise<InvestigationReport> {
	const model = resolveModel(cfg.providerId, cfg.model, {
		apiKey: cfg.apiKey,
		baseURL: cfg.baseURL,
	});
	const basePrompt = `${SYSTEM}\n\n=== INVESTIGATION TRANSCRIPT ===\n${transcript}\n=== END TRANSCRIPT ===\n\nWrite the report now.`;

	try {
		const { object } = await generateObject({
			model,
			schema: InvestigationReportSchema,
			prompt: basePrompt,
		});
		return object;
	} catch {
		// Fallback: some OpenAI-compat endpoints reject json-schema response_format.
		const { text } = await generateText({
			model,
			prompt: `${basePrompt}\n\nRespond with ONLY a single JSON object (no prose, no code fences) matching exactly this shape:\n${SHAPE_HINT}`,
		});
		return InvestigationReportSchema.parse(extractJsonObject(text));
	}
}

/** Pull the first balanced top-level JSON object out of a model completion. */
export function extractJsonObject(text: string): unknown {
	const cleaned = text.replace(/```(?:json)?/gi, "");
	const start = cleaned.indexOf("{");
	if (start === -1)
		throw new Error("synthesize: no JSON object found in completion");
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < cleaned.length; i++) {
		const ch = cleaned[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === "{") depth++;
		else if (ch === "}" && --depth === 0) {
			return JSON.parse(cleaned.slice(start, i + 1));
		}
	}
	throw new Error("synthesize: unterminated JSON object in completion");
}
