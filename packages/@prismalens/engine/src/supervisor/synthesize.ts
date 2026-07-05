/**
 * Reduce — the Tier-1 supervisor's join (ADR-0016 decision 2): compact each branch's
 * canonical stream into a transcript ({@link buildTranscript}) and synthesize the
 * structured ordered-evidence report ({@link synthesizeReport}, ADR-0002). The LLM is
 * used ONLY here (decompose is deterministic; the inner ReAct loop is rented), via the
 * Vercel AI SDK (provider-agnostic, BYO-key) — NOT the rented harness.
 *
 * MAP-REDUCE (ADR-0016 decision 2 / critique C3 "a single reduce won't scale to N>1"):
 *   - N=1 branch  ⇒ EXACTLY one synthesis call over the one transcript (no extra LLM
 *                   cost — the CLI/degenerate path is unchanged; protected by a test).
 *   - N>1 branches ⇒ MAP: per-branch synthesis over each branch transcript (parallel),
 *                    then REDUCE: ONE further model call merging the per-branch reports
 *                    — cross-branch dedupe, ordered-evidence rank (position IS the rank,
 *                    ADR-0002 — no numeric confidence), ruled-out UNION. Branches with
 *                    zero tool evidence are EXCLUDED from the map (per-branch no-evidence
 *                    guard); the ALL-branches-empty ⇒ no-report case is handled run-level
 *                    upstream (investigateIncidentStream returns before reduce()).
 *
 * Robustness: try the SDK's structured-object path first; if the (BYO, possibly
 * OpenAI-compat) endpoint can't honour the JSON-schema constraint, fall back to a
 * plain completion + manual extraction, and validate the result against
 * `InvestigationReportSchema` either way (AGENTS.md gate 1: validate at the boundary).
 */
import type { LLMProviderId } from "@prismalens/config/llm";
import { resolveModel } from "@prismalens/config/model";
import {
	type CanonicalEvent,
	type FiringAlert,
	type InvestigationContext,
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

const MERGE_SYSTEM = `You are a senior Site Reliability Engineer consolidating SEVERAL per-branch root-cause reports into ONE report for the SAME incident. Each input report investigated a different firing alert of that incident.

Merge rules (strict):
- DEDUPE across branches: the SAME hypothesis raised by multiple branches becomes ONE hypothesis; UNITE its evidence (keep every distinct item, drop exact duplicates).
- RANK by array position (most → least plausible). Position IS the rank — do NOT use numeric confidence/probability (ADR-0002 ordered-evidence).
- ruledOut is the UNION across branches (dedupe identical entries).
- coverage.queried / coverage.notQueried are the UNION across branches.
- Ground every claim in the provided per-branch reports — do NOT invent evidence.`;

const PREVIEW_CAP = 1200;
const TRANSCRIPT_CAP = 24_000;

/**
 * The one model call the reduce step makes, factored out so it is INJECTABLE — the
 * default hits the LLM (below); hermetic tests pass a stub that records the prompt +
 * call count and returns a canned report, so the map-reduce orchestration is tested
 * with NO live LLM (mirrors the stub-harness pattern in the pipeline tests).
 */
export type ReportModel = (
	prompt: string,
	cfg: SynthesisModelConfig,
) => Promise<InvestigationReport>;

const defaultReportModel: ReportModel = (prompt, cfg) =>
	runReportModel(cfg, prompt);

/**
 * The reduce step (ADR-0016 decision 2): map-reduce over the collected branch stream.
 * One branch ⇒ a single synthesis (unchanged). N branches ⇒ per-branch synthesis
 * (map, parallel) then one cross-branch merge (reduce). `model` is injectable for
 * hermetic tests; production leaves it defaulted to the real LLM call.
 */
export async function reduce(
	context: InvestigationContext,
	events: CanonicalEvent[],
	cfg: SynthesisModelConfig,
	model: ReportModel = defaultReportModel,
): Promise<InvestigationReport> {
	const groups = groupEventsByBranch(events);

	// N=1: exactly today's single synthesis call over the whole transcript. No fan-out
	// bookkeeping, no extra LLM cost.
	if (groups.length <= 1) {
		return model(synthesisPrompt(buildTranscript(context, events)), cfg);
	}

	// N>1 MAP: synthesize each NON-EMPTY branch (a branch with zero tool_result is
	// excluded — the per-branch no-evidence guard, ADR-0002 — so it can't launder a
	// fabricated report into the merge). The all-empty ⇒ no-report case is caught
	// run-level before reduce() runs, so ≥1 branch has evidence here. Each branch's
	// transcript names ITS OWN focus alert as the firing alert — labelling every
	// branch with alerts[0] would attribute b1..bN's evidence to the wrong alert and
	// defeat per-alert fan-out (ADR-0016 decision 2).
	const nonEmpty = groups.filter((g) => hasToolEvidence(g.events));

	// A single surviving branch needs no merge — merging one report with itself is a
	// wasted LLM call; return it directly (same no-extra-cost principle as N=1).
	if (nonEmpty.length === 1) {
		const only = nonEmpty[0];
		return model(
			synthesisPrompt(
				buildTranscript(
					context,
					only.events,
					branchFocus(context, only.branchId),
				),
			),
			cfg,
		);
	}

	const perBranch = await Promise.all(
		nonEmpty.map((g) =>
			model(
				synthesisPrompt(
					buildTranscript(context, g.events, branchFocus(context, g.branchId)),
				),
				cfg,
			),
		),
	);

	// N>1 REDUCE: one further call merging the per-branch reports (dedupe + rank +
	// ruled-out union).
	return model(mergePrompt(context, perBranch), cfg);
}

/**
 * Group a branch stream by branchId, preserving arrival order both across groups
 * (insertion order) and within a group. The terminal `report` event carries no
 * branchId and is never in `reduce()`'s input, so every event here is branch-scoped.
 */
function groupEventsByBranch(
	events: CanonicalEvent[],
): Array<{ branchId: string; events: CanonicalEvent[] }> {
	const byId = new Map<string, CanonicalEvent[]>();
	for (const ev of events) {
		if (!("branchId" in ev)) continue;
		const group = byId.get(ev.branchId);
		if (group) group.push(ev);
		else byId.set(ev.branchId, [ev]);
	}
	return [...byId.entries()].map(([branchId, evs]) => ({
		branchId,
		events: evs,
	}));
}

/**
 * The focus alert a fan-out branch investigated: decompose emits `b<i>` for
 * `context.alerts[i]` (its id namespace — the two functions are a pair); the single
 * `root` branch (or any unknown id) has no focus and falls back to alerts[0].
 */
function branchFocus(
	context: InvestigationContext,
	branchId: string,
): FiringAlert | undefined {
	const m = /^b(\d+)$/.exec(branchId);
	return m ? context.alerts[Number(m[1])] : undefined;
}

/** A branch produced real evidence iff it emitted ≥1 tool_result (ADR-0002). */
function hasToolEvidence(events: CanonicalEvent[]): boolean {
	return events.some((e) => e.kind === "tool_result");
}

/** The per-branch synthesis prompt (the transcript wrapped for the reduce model). */
function synthesisPrompt(transcript: string): string {
	return `${SYSTEM}\n\n=== INVESTIGATION TRANSCRIPT ===\n${transcript}\n=== END TRANSCRIPT ===\n\nWrite the report now.`;
}

/**
 * The cross-branch merge prompt (ADR-0016 decision 2): a compact incident header +
 * every per-branch report serialized, for the one reduce-side consolidation call.
 */
function mergePrompt(
	context: InvestigationContext,
	reports: InvestigationReport[],
): string {
	const header = context.alerts.map((a) => a.alertname).join(", ");
	const body = reports
		.map((r, i) => `--- BRANCH ${i} REPORT ---\n${JSON.stringify(r, null, 2)}`)
		.join("\n\n");
	return `${MERGE_SYSTEM}\n\nINCIDENT ALERTS: ${header}\n\n=== PER-BRANCH REPORTS ===\n${body}\n=== END REPORTS ===\n\nWrite the consolidated report now.`;
}

const SHAPE_HINT = `{
  "summary": string,
  "rootCause": string | null,
  "rootCauseCategory": "code" | "config" | "infrastructure" | "external" | "unknown" | null,
  "hypotheses": [ { "statement": string, "status": "confirmed" | "supported" | "speculative" | "refuted", "evidence": [ { "observation": string, "source": string, "direction": "supports" | "contradicts", "status": "verified" | "inferred" } ] } ],
  "ruledOut": [ { "statement": string, "why": string, "evidence": [ { "observation": string, "source": string, "direction": "supports" | "contradicts", "status": "verified" | "inferred" } ] } ],
  "coverage": { "queried": string[], "notQueried": string[] },
  "nextSteps": [ { "title": string, "detail": string, "priority": "critical" | "high" | "medium" | "low" | null } ]
}`;

/**
 * Synthesize ONE branch transcript into an ordered-evidence report — the map step's
 * unit (and the whole of the N=1 path). Kept as a named export (byte-identical model
 * call to the pre-map-reduce behaviour) for callers/tests that synthesize a single
 * transcript directly.
 */
export async function synthesizeReport(
	transcript: string,
	cfg: SynthesisModelConfig,
): Promise<InvestigationReport> {
	return runReportModel(cfg, synthesisPrompt(transcript));
}

/**
 * The real LLM call behind {@link defaultReportModel}: resolve the model and generate
 * an InvestigationReport for `prompt`. Try the structured-object path first; on an
 * endpoint that rejects json-schema response_format, fall back to a plain completion +
 * manual extraction. Validated against the schema either way (AGENTS.md boundary gate).
 */
async function runReportModel(
	cfg: SynthesisModelConfig,
	prompt: string,
): Promise<InvestigationReport> {
	const model = resolveModel(cfg.providerId, cfg.model, {
		apiKey: cfg.apiKey,
		baseURL: cfg.baseURL,
	});

	try {
		const { object } = await generateObject({
			model,
			// fidelity is run-metadata, attached deterministically AFTER synthesis
			// (ADR-0017) — the LLM must NOT generate it, so omit it from the schema.
			schema: InvestigationReportSchema.omit({ fidelity: true }),
			prompt,
		});
		return object;
	} catch {
		// Fallback: some OpenAI-compat endpoints reject json-schema response_format.
		const { text } = await generateText({
			model,
			prompt: `${prompt}\n\nRespond with ONLY a single JSON object (no prose, no code fences) matching exactly this shape:\n${SHAPE_HINT}`,
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

/**
 * Compact the canonical stream into a transcript the reduce model can read. With a
 * `focus` (a fan-out branch's designated alert, ADR-0016 decision 2) that alert is
 * the FIRING ALERT and every other alert is related; without one, the N=1 path is
 * byte-identical to the original `[primary, ...rest] = context.alerts`.
 */
export function buildTranscript(
	context: InvestigationContext,
	events: CanonicalEvent[],
	focus?: FiringAlert,
): string {
	const primary = focus ?? context.alerts[0];
	const rest = context.alerts.filter((a) => a !== primary);
	const lines: string[] = [
		`FIRING ALERT: ${primary.alertname} (severity=${primary.severity ?? "unknown"})`,
		`annotations: ${JSON.stringify(primary.annotations)}`,
		...(rest.length
			? [`related alerts: ${rest.map((a) => a.alertname).join(", ")}`]
			: []),
		"",
		"AGENT INVESTIGATION (steps, tool calls, and observed results):",
	];
	for (const ev of events) {
		if (ev.kind === "agent_step") {
			if (ev.text.trim()) lines.push(`\n[think] ${ev.text.trim()}`);
			for (const tc of ev.toolCalls) {
				lines.push(
					`[call] ${tc.name} ${JSON.stringify(tc.args).slice(0, 300)}`,
				);
			}
		} else if (ev.kind === "tool_result") {
			const r = ev.result;
			lines.push(
				`[result ${r.ok ? "ok" : "ERROR"}] ${r.source}\n${truncate(r.preview, PREVIEW_CAP)}`,
			);
		} else if (ev.kind === "branch_done") {
			lines.push(`\n[branch ended: ${ev.reason}]`);
		} else if (ev.kind === "error") {
			lines.push(`\n[branch error: ${ev.message}]`);
		}
	}
	return truncate(lines.join("\n"), TRANSCRIPT_CAP);
}

function truncate(s: string, cap: number): string {
	return s.length > cap ? `${s.slice(0, cap)}\n…[truncated]` : s;
}
