/**
 * Decompose — the Tier-1 supervisor's fan-out planner (ADR-0016). Turns the host-
 * assembled InvestigationContext (ADR-0015) into the set of independent BRANCHES to
 * run on a rented harness.
 *
 * DETERMINISTIC — no LLM call here (in deliberate contrast to the rented inner
 * ReAct loop). Two policies, keyed on how many alerts the host correlated into the
 * context (ADR-0016 decision 2):
 *   - 1 alert  ⇒ ONE branch over the whole context (branchId "root") — unchanged.
 *   - N alerts ⇒ per-alert FAN-OUT: one branch PER alert, each carrying the FULL
 *                shared context but a designated FOCUS alert (its siblings rendered
 *                as related), capped at `maxBranches` (default 3).
 * The Branch[] shape has always been fan-out-ready, so this is purely additive — no
 * caller sees a contract shift. Per-hypothesis branching stays rejected until a
 * scored eval justifies it (the FORGE'26 caveat — top-level agentic orchestration is
 * net-negative for RCA, so all iterative depth belongs INSIDE a branch).
 */
import type { FiringAlert, InvestigationContext } from "@prismalens/contracts";

/** One unit of investigation the supervisor hands to a rented harness. */
export interface Branch {
	/** Stable per-run branch id — the (branchId, seq) stream key (ADR-0008). */
	branchId: string;
	/** The on-call brief this branch investigates. */
	prompt: string;
}

/** Tuning knobs for the fan-out planner (ADR-0016 decision 2). */
export interface DecomposeOptions {
	/**
	 * Cap on the number of per-alert branches (default {@link DEFAULT_MAX_BRANCHES}).
	 * Only bites on the multi-alert path; a single-alert run is always one branch.
	 */
	maxBranches?: number;
}

/** Per-alert fan-out cap when the caller doesn't set one (ADR-0016 decision 2). */
export const DEFAULT_MAX_BRANCHES = 3;

/**
 * Plan the branches for a context (ADR-0016 decision 2). 1 alert ⇒ exactly today's
 * single "root" branch over the whole context (byte-identical prompt — no behaviour
 * change on the CLI/degenerate path). >1 alert ⇒ one branch per alert (ids "b0",
 * "b1", …; path stays [] — nesting is intra-branch), each the full shared context
 * with a different FOCUS alert, capped at `maxBranches`.
 *
 * Cap ordering: we do NOT re-sort — we take the FIRST N alerts in the array order the
 * host supplied. Per ADR-0015 the host owns context assembly (and any severity
 * ordering), so "first N" is "the N most-severe" when the host ordered by severity,
 * and a stable, predictable prefix otherwise. The engine stays db/policy-clean.
 */
export function decompose(
	context: InvestigationContext,
	opts: DecomposeOptions = {},
): Branch[] {
	// N=1 (incl. the single-alert CLI path): one branch over the whole context. Kept
	// byte-identical to the pre-fan-out behaviour — protected by a test.
	if (context.alerts.length <= 1) {
		return [{ branchId: "root", prompt: buildInvestigationPrompt(context) }];
	}
	// N>1: per-alert fan-out, capped. `slice(0, cap)` takes the first N (see ordering
	// note above); a non-positive cap degrades to one branch rather than zero.
	const cap = Math.max(1, opts.maxBranches ?? DEFAULT_MAX_BRANCHES);
	return context.alerts.slice(0, cap).map((focus, i) => ({
		branchId: `b${i}`,
		prompt: buildInvestigationPrompt(context, focus),
	}));
}

/**
 * The neutral on-call brief handed to the rented harness. Built from the FOCUS alert
 * (defaults to the first alert — the single-branch case), with the remaining alerts
 * rendered as related; the optional service / related-alert / log blocks appear only
 * when the host supplied them, so a bare single-alert run is unchanged (ADR-0015).
 */
export function buildInvestigationPrompt(
	context: InvestigationContext,
	focus?: FiringAlert,
): string {
	// No focus ⇒ the N=1 path: primary = alerts[0], rest = the tail (byte-identical to
	// the original `const [primary, ...rest] = context.alerts`). With a focus (fan-out)
	// the focus alert becomes primary and every OTHER alert is a sibling/related.
	const primary = focus ?? context.alerts[0];
	const rest = focus
		? context.alerts.filter((a) => a !== focus)
		: context.alerts.slice(1);
	const t = context.telemetry;
	const labels = JSON.stringify(primary.labels);
	const annotations = JSON.stringify(primary.annotations);

	const s = context.service;
	const serviceBlock = s
		? `\n\nAFFECTED SERVICE\n  name: ${s.name}${
				s.tier ? `   ·   tier: ${s.tier}` : ""
			}${s.repo ? `   ·   repo: ${s.repo}` : ""}${
				s.dependsOn?.length ? `\n  depends on: ${s.dependsOn.join(", ")}` : ""
			}`
		: "";

	const relatedBlock = rest.length
		? `\n\nRELATED FIRING ALERTS (same incident — correlate, don't investigate in isolation)\n${rest
				.map((a) => `  - ${a.alertname} (severity=${a.severity ?? "unknown"})`)
				.join("\n")}`
		: "";

	const logsSurface = context.logs?.url
		? `\n  - Logs (${context.logs.kind ?? "log system"})   ${context.logs.url}      query recent logs for the affected service`
		: "";

	return `You are an on-call Site Reliability Engineer running a LIVE investigation of a firing production alert. Your job is to find the ROOT CAUSE — the specific code path, configuration, dependency, or resource that produced this alert — not merely the symptom.

FIRING ALERT
  name:        ${primary.alertname}
  severity:    ${primary.severity ?? "unknown"}
  labels:      ${labels}
  annotations: ${annotations}${serviceBlock}${relatedBlock}

READ-ONLY SURFACES (never modify, deploy, restart, or write anything)
  - Prometheus    ${t.prometheusUrl}
      curl -s '${t.prometheusUrl}/api/v1/query' --data-urlencode 'query=<promql>'   ·   /api/v1/rules   ·   /api/v1/label/__name__/values
  - Alertmanager  ${t.alertmanagerUrl}      curl -s '${t.alertmanagerUrl}/api/v2/alerts'
  - Application API ${t.apiUrl}${logsSurface}
  - Application SOURCE CODE is in your current working directory — ls / cat / grep / head.

METHOD (work iteratively — think → run a command → observe → decide)
  1. Confirm the alert's signal in Prometheus: which metric/expression fired and how far past threshold.
  2. After EACH command, say in one line what you learned and what you will check next; let the evidence pick the next probe.
  3. Localize, then go to the code. Identify WHICH operation/endpoint/component the signal is about — e.g. for a latency
     alert, find the SLOWEST endpoint or operation — then READ that code path's handler and the configuration it depends on.
  4. Never run the same command with the same arguments twice. If your last couple of probes produced nothing new, stop and write the diagnosis.

WHAT COUNTS AS A ROOT CAUSE (important)
  Restating the symptom is NOT a root cause. "The service is slow / unresponsive / latency is high" is the alert restated,
  not its cause. A surface symptom (e.g. requests timing out) is almost always a downstream EFFECT — keep digging until you
  can name the concrete code, configuration, dependency, or resource responsible and explain the mechanism that links it to
  the alert.

OUTPUT
  State the single most likely root cause and the mechanism. List the evidence as VALIDATED (a command/metric/file directly
  showed it — quote the exact command) versus INFERRED (reasoned, not directly observed). Recommend a fix. Be specific and
  concise; never assert without evidence.`;
}
