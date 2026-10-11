// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AlertRule } from "@prismalens/integrations";

export interface Scoped<T> {
	state: "scoped" | "several" | "unscoped";
	/** The series to show: the matching ones, or all of them when unscoped. */
	series: T[];
	matched: number;
}

/** The rule whose `query` is the stored expression byte for byte, when exactly one such rule is loaded. */
export function exactRule(rules: AlertRule[], expr: string): AlertRule | null {
	const exact = rules.filter((r) => r.query === expr);
	return exact.length === 1 ? (exact[0] ?? null) : null;
}

/**
 * Which returned series are this alert's (research-data "Series scope", #811). A rule may overwrite a
 * label such as `instance`, so labels the rule sets cannot identify a series: if a series carries one
 * with another value, nothing is scoped. Otherwise a series is the alert's when its labels, without
 * `__name__` and the rule's own, all appear on the alert with equal values.
 */
export function scopeSeries<T extends { labels: Record<string, string> }>(
	series: T[],
	alertLabels: Record<string, string>,
	rule: AlertRule | null,
): Scoped<T> {
	const unscoped: Scoped<T> = { state: "unscoped", series, matched: 0 };
	if (!rule) return unscoped;
	const ruleKeys = Object.keys(rule.labels);
	const overwritten = series.some((s) =>
		ruleKeys.some(
			(k) => s.labels[k] !== undefined && s.labels[k] !== rule.labels[k],
		),
	);
	if (overwritten) return unscoped;
	const mine = series.filter((s) =>
		Object.entries(s.labels).every(
			([k, v]) =>
				k === "__name__" || ruleKeys.includes(k) || alertLabels[k] === v,
		),
	);
	if (mine.length === 0) return unscoped;
	return {
		state: mine.length === 1 ? "scoped" : "several",
		series: mine,
		matched: mine.length,
	};
}
