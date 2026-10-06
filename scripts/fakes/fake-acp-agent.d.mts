// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export interface ToolStep {
	id: string;
	title: string;
	kind?: string;
	rawInput: Record<string, unknown>;
	/** false: run it without a permission request. */
	ask?: boolean;
	output?: string;
}

export interface Step {
	delayMs?: number;
	say?: string;
	think?: string;
	update?: Record<string, unknown>;
	tool?: ToolStep;
	report?: Record<string, unknown>;
	stderr?: string;
	exit?: number;
	waitForCancel?: boolean;
	/** Hold until `releaseRun(key)` names a key the first prompt contains. */
	waitForRelease?: boolean;
	stop?: string;
}

export interface FakeSession {
	agent?: { name: string; version: string };
	loadSession?: boolean;
	configOptions?: unknown[];
	turns?: Step[][];
	followUp?: Step[];
	load?: Step[];
}

export const SESSIONS_DIR: string;
export const FAKE_AGENT_PATH: string;
export function loadSession(nameOrPath: string): FakeSession;
export function releaseDir(stateDir?: string): string;
export function releaseRun(key: string, stateDir?: string): void;
export function installFakeAgent(
	binDir: string,
	opts?: { session?: string; binaries?: string[]; stateDir?: string },
): string[];
