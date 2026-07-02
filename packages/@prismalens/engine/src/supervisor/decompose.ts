/**
 * Decompose — the Tier-1 supervisor's fan-out planner (ADR-0016). Turns the host-
 * assembled InvestigationContext (ADR-0015) into the set of independent BRANCHES to
 * run on a rented harness.
 *
 * DETERMINISTIC — no LLM call here (in deliberate contrast to the rented inner
 * ReAct loop). The policy is N=1 today: ONE branch over the whole context. The
 * Branch[] shape is already fan-out-ready, so per-alert fan-out (a later slice —
 * concurrency-capped run + a reduce-side cross-branch dedupe) is purely additive and
 * needs no contract change. Per-hypothesis branching stays rejected until a scored
 * eval justifies it (the FORGE'26 caveat — top-level agentic orchestration is
 * net-negative for RCA, so all iterative depth belongs INSIDE a branch).
 */
import type { InvestigationContext } from "@prismalens/contracts";

/** One unit of investigation the supervisor hands to a rented harness. */
export interface Branch {
	/** Stable per-run branch id — the (branchId, seq) stream key (ADR-0008). */
	branchId: string;
	/** The on-call brief this branch investigates. */
	prompt: string;
}

/**
 * Current policy: ONE branch over the whole context (N=1). Returning a list keeps
 * per-alert fan-out a purely additive change — no caller sees a contract shift.
 */
export function decompose(context: InvestigationContext): Branch[] {
	return [{ branchId: "root", prompt: buildInvestigationPrompt(context) }];
}

/**
 * The neutral on-call brief handed to the rented harness. Built from the primary
 * firing alert; the optional service / related-alert / log blocks are rendered only
 * when the host supplied them, so a bare single-alert run is unchanged (ADR-0015).
 */
export function buildInvestigationPrompt(
	context: InvestigationContext,
): string {
	const [primary, ...rest] = context.alerts;
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
