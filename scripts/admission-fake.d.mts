// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export const FAKE_MODEL: string;

export interface AdmissionVerdict {
	pass: boolean;
	failedChecks: string[];
	r5: string;
	r6: string;
	r7: string;
	r8: string;
	r9: string;
}

export function agentEnv(
	harness: "opencode" | "claude-code" | "codex",
	fake: { url: string; openaiBaseUrl: string },
	home: string,
): Record<string, string>;

export function verdictOf(stdout: string): AdmissionVerdict;

export function signature(verdict: AdmissionVerdict): string;
