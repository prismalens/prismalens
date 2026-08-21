// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Sample JSON shown in the `/rules` dialogs (#294).
 *
 * These are not decoration: they are the shapes the engine actually evaluates.
 * Correlation nests its predicates under `match` (`alertMatchesRule` in
 * `correlation.service.ts` returns false without it); alert mapping reads a flat
 * object (`matchesRule` in `alert-mapping.service.ts`). Keep them in step with
 * `docs/ui-flows-and-e2e-strategy.md` J15 and `e2e/journeys/rules-management.spec.ts`.
 */

export const CORRELATION_CRITERIA_SAMPLE = JSON.stringify(
	{ match: { severity: ["critical"], source: "prometheus" } },
	null,
	2,
);

export const CORRELATION_ALERT_SAMPLE = JSON.stringify(
	{
		title: "Checkout latency above SLO",
		severity: "critical",
		source: "prometheus",
	},
	null,
	2,
);

export const MAPPING_CRITERIA_SAMPLE = JSON.stringify(
	{ source: "prometheus", labels: { team: "checkout" } },
	null,
	2,
);

export const MAPPING_ALERT_SAMPLE = JSON.stringify(
	{
		title: "Checkout latency above SLO",
		source: "prometheus",
		labels: { team: "checkout" },
	},
	null,
	2,
);

/**
 * Parse a match-criteria textarea. Returns the parsed object, or an error string
 * suitable for the dialog's `error` state.
 */
export function parseMatchCriteria(
	raw: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, error: "Match criteria must be valid JSON" };
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { ok: false, error: "Match criteria must be a JSON object" };
	}
	return { ok: true, value: parsed as Record<string, unknown> };
}
