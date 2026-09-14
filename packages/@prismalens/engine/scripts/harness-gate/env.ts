// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The gate must never spend the operator's own harness login or key (a Claude subscription
 * used through another tool breaks Anthropic's terms). Harnesses get an allowlisted env,
 * HOME inside the fixture, and a loopback model endpoint only.
 */
const PASS_THROUGH = ["PATH", "LANG", "LC_ALL", "TERM", "SHELL", "TMPDIR"];

export function harnessEnv(
	home: string,
	extra: Record<string, string>,
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const name of PASS_THROUGH) {
		const value = process.env[name];
		if (value !== undefined) env[name] = value;
	}
	return { ...env, HOME: home, ...extra };
}

export function assertLoopback(baseUrl: string): void {
	const host = new URL(baseUrl).hostname;
	if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host))
		throw new Error(
			`model endpoint ${baseUrl} is not loopback; the gate only talks to a local endpoint (Ollama)`,
		);
}
