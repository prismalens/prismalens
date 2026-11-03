// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { GITHUB_TOKEN_VARS } from "@prismalens/agent-host";

/** Shorter values would redact ordinary words; real tokens and bearers are longer. */
const MIN_SECRET = 12;

/**
 * The credential values a run's agent may hold: GitHub tokens in its env (any letter case,
 * as Windows reads names) and PrismaLens's own extras such as the gateway bearer (#1020).
 */
export function injectedSecrets(
	env: Readonly<Record<string, string | undefined>>,
	extra: readonly (string | undefined)[] = [],
): string[] {
	const names = new Set<string>(GITHUB_TOKEN_VARS);
	const values = [
		...Object.entries(env)
			.filter(([k]) => names.has(k.toUpperCase()))
			.map(([, v]) => v),
		...extra,
	];
	return [
		...new Set(
			values.filter((v): v is string => !!v && v.length >= MIN_SECRET),
		),
	];
}

/** The event with every exact secret value replaced; the same object when none occurs. */
export function redactEvent<T>(event: T, secrets: readonly string[]): T {
	if (!secrets.length) return event;
	const text = JSON.stringify(event);
	if (!secrets.some((s) => text.includes(s))) return event;
	// Replace inside the JSON string form, so a value is caught in any field, nested or not.
	let out = text;
	for (const s of secrets)
		out = out.replaceAll(JSON.stringify(s).slice(1, -1), "[redacted]");
	return JSON.parse(out) as T;
}
