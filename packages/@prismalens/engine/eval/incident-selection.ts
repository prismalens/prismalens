// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Choosing WHICH firing alerts a paired A/B run investigates, and what to file
 * the resulting capture under.
 *
 * Extracted from the live suite so it is unit-testable: the suite itself is
 * env-gated and skips on any machine without the sreforge substrate, so bugs in
 * here were previously only discoverable by spending a live run. One already was
 * — see {@link pickIncidentAlerts}.
 */

/** The subset of a firing alert this module needs. */
export interface NamedAlert {
	alertname: string;
}

export function slug(s: string): string {
	return (
		s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "incident"
	);
}

/**
 * The alert(s) both arms are briefed on.
 *
 * `INCIDENT_ALERTNAMES` (comma-separated) drives a **storm** scenario, where
 * grouping N correlated alerts into one incident IS the discrimination axis
 * (sreforge#65). Every named alert must be firing — a storm missing members is a
 * different incident, and quietly investigating the subset would measure the
 * wrong thing while looking like a clean run.
 *
 * `INCIDENT_ALERTNAME` (singular) names one alert for single-alert scenarios.
 *
 * With neither set this falls back to the first firing alert, which is fine ad
 * hoc and wrong for a campaign: an armed stack also fires load-plane furniture
 * (`EdgeClientRequestJitter`), and alertmanager order is not incident order. That
 * fallback once briefed both arms on the jitter alert while the judge scored
 * against the scenario's pool-exhaustion oracle — both arms "failed" for a reason
 * unrelated to either agent.
 */
export function pickIncidentAlerts<T extends NamedAlert>(
	alerts: T[],
	env: NodeJS.ProcessEnv = process.env,
): T[] {
	if (alerts.length === 0) {
		throw new Error("no firing alerts — nothing to investigate");
	}

	const storm = env.INCIDENT_ALERTNAMES?.trim();
	const single = env.INCIDENT_ALERTNAME?.trim();
	if (storm && single) {
		throw new Error(
			"INCIDENT_ALERTNAMES and INCIDENT_ALERTNAME are both set — pick one.",
		);
	}

	const wanted = storm
		? storm
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: single
			? [single]
			: [];

	if (storm && wanted.length === 0) {
		throw new Error(
			"INCIDENT_ALERTNAMES is set but names no alerts — refusing the first-alert fallback.",
		);
	}
	if (wanted.length === 0) return [alerts[0]];

	const picked: T[] = [];
	const missing: string[] = [];
	for (const name of wanted) {
		const match = alerts.find((a) => a.alertname === name);
		if (match) picked.push(match);
		else missing.push(name);
	}

	if (missing.length > 0) {
		const firing = alerts.map((a) => a.alertname).join(", ");
		throw new Error(
			`incident alert(s) not firing: [${missing.join(
				", ",
			)}] — got [${firing}]. Refusing to investigate a different incident.`,
		);
	}
	return picked;
}

/**
 * The label the capture is filed under.
 *
 * `INCIDENT_SCENARIO` names it explicitly. Without it this falls back to the
 * alert slug, which is what the suite used before and is wrong in two ways worth
 * naming: every booklogr scenario fires `BooklogrApiLatencyP99High`, so the label
 * identifies the alert rather than the scenario; and a storm has no single alert
 * to be named after.
 */
export function scenarioLabel(
	incidentAlerts: NamedAlert[],
	env: NodeJS.ProcessEnv = process.env,
): string {
	const explicit = env.INCIDENT_SCENARIO?.trim();
	if (explicit) return slug(explicit);
	if (incidentAlerts.length === 0) {
		throw new Error("scenarioLabel: no incident alerts to derive a label from");
	}
	return slug(incidentAlerts[0].alertname);
}
