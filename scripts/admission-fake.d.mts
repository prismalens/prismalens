// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export const FAKE_MODEL: string;
export const AGENTS: string[];

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
	harness: string,
	model: { url: string; openaiBaseUrl: string },
	home: string,
	key?: string | null,
): Record<string, string>;

export function verdictOf(stdout: string): AdmissionVerdict;

export function signature(verdict: AdmissionVerdict): string;

export function matrixSignature(stdout: string): string;

export function parseArgs(argv: string[]): {
	harness: string;
	cloneDir: string;
	repeat: number;
	admission: boolean;
	matrix: boolean;
	rows: string | undefined;
	journal: boolean;
} | null;
