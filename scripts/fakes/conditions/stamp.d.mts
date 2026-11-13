// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export const REPO_ROOT: string;
export function commitSha(): string;
export function runId(): string;
export function stampDir(): string;
export function conditionEntry(condition: string): {
	id: string;
	status: string;
	simulator: { id: string };
	profile: Record<string, unknown>;
	walks: string[];
};
export function writeStamp(input: {
	condition: string;
	simulator: string;
	observed: Record<string, unknown>;
	detail?: unknown;
	/** Artifacts already in the stamp dir, by their path relative to it. */
	files?: string[];
}): string[];
