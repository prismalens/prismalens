// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export interface Stamp {
	version: 1;
	condition: string;
	simulator: string;
	profile: Record<string, unknown>;
	observed: Record<string, unknown>;
	commit: string;
	runId: string;
	artifacts: Record<string, string>;
	at: string;
}

export const REPO_ROOT: string;
export function commitSha(): string;
export function stampDir(): string;
export function sha256File(file: string): string;
export function writeStamp(input: {
	condition: string;
	simulator: string;
	profile: Record<string, unknown>;
	observed: Record<string, unknown>;
	artifacts?: string[];
}): string;
