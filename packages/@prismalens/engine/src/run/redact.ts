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
	// Match the JSON-escaped form: a secret with a quote, backslash or newline is escaped in `text`.
	const escaped = secrets.map((s) => JSON.stringify(s).slice(1, -1));
	if (!escaped.some((s) => text.includes(s))) return event;
	let out = text;
	for (const s of escaped) out = out.replaceAll(s, "[redacted]");
	return JSON.parse(out) as T;
}

/**
 * The secrets a user handed this thread through `secret_request` (#1024 spec B): each is
 * redacted whatever its length, unlike {@link injectedSecrets}, since the user said it is one.
 */
export function requestedSecrets(
	values: readonly (string | undefined)[] | undefined,
): string[] {
	return (
		[...new Set((values ?? []).filter((v): v is string => !!v))]
			// The longest first, so a secret inside another never leaves a piece behind.
			.sort((a, b) => b.length - a.length)
	);
}

/** `text` with every exact secret value replaced. */
export function scrub(text: string, secrets: readonly string[]): string {
	let out = text;
	for (const s of secrets) out = out.replaceAll(s, "[redacted]");
	return out;
}
