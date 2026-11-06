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

/** A JSON-RPC error the prompt answers with (#1024). */
export interface RpcErrorStep {
	code: number;
	message: string;
	data?: unknown;
}

/** Calls one of PrismaLens's gateway tools over MCP; needs `--mcp` (#1024). */
export interface CallStep {
	tool: string;
	/** `{{prompt}}`, `{{result}}` and `{{send-to}}` are filled in its strings. */
	arguments?: Record<string, unknown>;
}

/** A sub-agent the step starts (#1025): its own session when the client declares sub-agents. */
export interface SubagentStep {
	/** Its ACP session id; with no sub-agent sessions, the parentToolUseId its steps carry. */
	id: string;
	title: string;
	description?: string;
	/** Grants the client `capabilities.cancel` for it. */
	cancel?: boolean;
	steps: Step[];
	/** Its stopReason when its steps end on their own. */
	end?: "end_turn" | "error";
}

export interface Step {
	delayMs?: number;
	/** Stamps the step's updates with `_meta.claudeCode.parentToolUseId` (#1025). */
	parent?: string;
	subagent?: SubagentStep;
	say?: string;
	think?: string;
	update?: Record<string, unknown>;
	tool?: ToolStep;
	call?: CallStep;
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
	/** Ends the turn with this JSON-RPC error instead of a stop reason. */
	error?: RpcErrorStep;
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
	/** A follow-up whose prompt contains `match` plays `steps` instead of `followUp` (#1024). */
	followUpWhen?: { match: string; steps: Step[] }[];
	load?: Step[];
	/** Answers a message to the run still in this process; `followUp` answers one after session/load. */
	steer?: Step[];
	/** Answers a `/compact` prompt; not counted as one of `turns` (#1024). */
	compact?: Step[];
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
		/** Advertise HTTP MCP, so runs offer the gateway and `call` steps work. */
		mcp?: boolean;
	},
): string[];
