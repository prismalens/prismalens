// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export interface ToolStep {
	id: string;
	title: string;
	kind?: string;
	rawInput: Record<string, unknown>;
	/** true: send a permission request first; the run waits on the operator's answer (#673 w21). */
	ask?: boolean;
	output?: string;
	/** Ends the call failed with this text, unasked: a refusal stored before #673 w21. */
	fail?: string;
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
	/** Sends `elicitation/create` (form mode) and says the answer back (#1024). */
	elicit?: { message: string; requestedSchema: Record<string, unknown> };
	/** Says each linked file's first 4,000 characters: a file:// one read from disk, any other named (#1024). */
	readLinks?: boolean;
}

export interface FakeSession {
	/** Why a hand-authored script stays (#914). */
	description?: string;
	agent?: { name: string; version: string };
	loadSession?: boolean;
	configOptions?: unknown[];
	/** `session/new`'s `modes`; absent advertises Claude Code's modes and OpenCode's agents (#673 w21). */
	modes?: {
		currentModeId: string;
		availableModes: { id: string; name: string; description?: string }[];
	};
	turns?: Step[][];
	followUp?: Step[];
	load?: Step[];
	/** Answers a message to the run still in this process; `followUp` answers one after session/load. */
	steer?: Step[];
	/** Answers the host's report retry ("Your final message did not …"). */
	retry?: Step[];
	/** Advertised as `promptCapabilities.image` at initialize. */
	images?: boolean;
	/** `session/set_config_option` keeps the old value. */
	refuseConfig?: boolean;
	/** Advertised as `sessionCapabilities.additionalDirectories` at initialize (#1024). */
	additionalDirectories?: boolean;
}

export const SESSIONS_DIR: string;
export const FAKE_AGENT_PATH: string;
export function loadSession(nameOrPath: string): FakeSession;
export function releaseDir(stateDir?: string): string;
export function releaseRun(key: string, stateDir?: string): void;
export function setFakeCapability(
	name: "additionalDirectories",
	on: boolean,
	stateDir?: string,
): void;
export function installFakeAgent(
	binDir: string,
	opts?: {
		session?: string;
		binaries?: string[];
		stateDir?: string;
	},
): string[];
