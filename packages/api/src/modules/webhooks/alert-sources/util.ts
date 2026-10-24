// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Severity } from "../../../shared/enums/index.js";
import type { Payload } from "./types.js";

export function asObject(value: unknown): Payload {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Payload)
		: {};
}

/** A non-empty string, or a number or boolean as text; anything else is absent. */
export function str(value: unknown): string | undefined {
	if (typeof value === "string") return value.trim() || undefined;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return undefined;
}

export function first(...values: unknown[]): string | undefined {
	for (const v of values) {
		const s = str(v);
		if (s) return s;
	}
	return undefined;
}

/** Drop absent values so a label set never carries `undefined` or blanks. */
export function labelsOf(
	entries: Record<string, string | undefined>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(entries).filter(
			(e): e is [string, string] => e[1] !== undefined && e[1] !== "",
		),
	);
}

/** P1..P5 priorities and the CRITICAL..LOW words, as Datadog, PagerDuty and New Relic name them. */
export function severityFromPriority(
	priority: string | undefined,
): Severity | undefined {
	switch (priority?.toUpperCase()) {
		case "P1":
		case "CRITICAL":
			return Severity.critical;
		case "P2":
		case "HIGH":
			return Severity.high;
		case "P3":
		case "MEDIUM":
		case "WARNING":
			return Severity.medium;
		case "P4":
		case "LOW":
			return Severity.low;
		case "P5":
		case "INFO":
			return Severity.info;
		default:
			return undefined;
	}
}
