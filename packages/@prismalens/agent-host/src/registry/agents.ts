// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The agents and their launch facts, one row per file under `agents/`. Every agent speaks ACP over stdio
 * (ADR 0003). Copy, `tested` pins and model resolution stay in each product (#916).
 */
import { antigravity } from "./agents/antigravity.js";
import { claudeCode } from "./agents/claude-code.js";
import { codex } from "./agents/codex.js";
import { copilot } from "./agents/copilot.js";
import { cursor } from "./agents/cursor.js";
import { deepagents } from "./agents/deepagents.js";
import { gemini } from "./agents/gemini.js";
import { goose } from "./agents/goose.js";
import { grok } from "./agents/grok.js";
import { kiro } from "./agents/kiro.js";
import { local } from "./agents/local.js";
import { opencode } from "./agents/opencode.js";
import { qwen } from "./agents/qwen.js";
import type { AgentFacts } from "./facts.js";
import type { AccessLevel, LevelFacts, ModeMechanism } from "./levels.js";

export const AGENT_IDS = [
	"opencode",
	"claude-code",
	"codex",
	"gemini",
	"cursor",
	"antigravity",
	"copilot",
	"kiro",
	"grok",
	"qwen",
	"goose",
	"deepagents",
	"local",
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** Per-run paths and facts a row's launch functions read. */
export interface AgentRunEnv {
	configDir: string;
	/** Empty per-run dir an agent can be pointed at for config it would otherwise read from the user's home. */
	dataDir: string;
	cwd: string;
	/** Absolute path of the row's `companionBinary` on PATH, when found. */
	companionPath?: string;
	/** The run starts the adapter the product ships, not one on PATH (#818). */
	shipped?: boolean;
	/** The product's MCP gateway and its per-run server name, set for a row with `gatewayDelivery` (#848). */
	gateway?: { url: string; token: string; name: string };
	/** The ANTHROPIC_BASE_URL the child gets from the host, stored and launch layers; unset when none. */
	anthropicBaseUrl?: string;
}

/**
 * Where an agent reads one sub-agent limit (#1024 spec B): an env var, a key inside a
 * JSON env var, or a key in one of the row's config files. Data, applied like `acpEnv`.
 */
export type SubagentLimitKey =
	| { env: string }
	| { jsonEnv: string; path: readonly string[] }
	| { configFile: string; path: readonly string[] };

/**
 * What happens to a turn's running in-session sub-agents when the user stops the turn
 * (#1101 cat 10, amendment 2026-11-13). Sub-agents are the agent's own helpers, never threads.
 */
export type SubagentStopChoice = "stop" | "finish";
export {
	GATEWAY_RUN_FILE,
	SUBAGENTS_ON_STOP_DEFAULT,
} from "./row.js";

/** One ACP `authenticate` method a row sends before `session/new`, when `env` names a set key or is absent. */
export interface AuthenticateMethod {
	methodId: string;
	env?: string;
	/** Sent though `initialize` does not list it: the agent takes a method it never advertises. */
	unlisted?: boolean;
}

/** The first of the row's methods that applies under `env`; null when it has none. */
export function authenticateMethod(
	row: Pick<AgentDescriptor, "authenticate">,
	env: Readonly<Record<string, string | undefined>>,
): AuthenticateMethod | null {
	return row.authenticate?.find((m) => !m.env || !!env[m.env]?.trim()) ?? null;
}

/** Whether `method` goes out: the agent listed it in `initialize`, or the row marks it unlisted. */
export function sendsAuthenticate(
	method: Pick<AuthenticateMethod, "methodId" | "unlisted">,
	listed: readonly { id: string }[] | null | undefined,
): boolean {
	return (
		method.unlisted === true || !!listed?.some((m) => m.id === method.methodId)
	);
}

export interface AgentDescriptor {
	id: AgentId;
	label: string;
	/** Binary looked up on PATH; empty for `local`, whose command the user sets. */
	binary: string;
	/** The vendor's own CLI the adapter drives, when it is a separate install. */
	companionBinary?: string;
	/** The npm package of the ACP adapter a product may ship for this agent (#818). */
	adapterPackage?: string;
	/** argv for `binary` that starts an ACP server on stdio in `cwd`. */
	acpArgs: (env: AgentRunEnv) => string[];
	/** Env vars the host sets on the child; Settings refuses them as stored values. */
	acpEnv: (env: AgentRunEnv) => Record<string, string>;
	/** Files written under configDir before the run. */
	configFiles?: (env: AgentRunEnv) => Record<string, string>;
	/** This config file goes inline in the env key instead, merged over a value the user set there. */
	configEnv?: { file: string; key: string };
	/** The agent ignores ACP `mcpServers`; the gateway goes in a run file instead (#848). */
	gatewayDelivery?: "mcp-config-file";
	/** `_meta` on ACP `session/new`; it may follow the user's sub-agent stop choice. */
	sessionMeta?: (o?: {
		subagentsOnStop?: SubagentStopChoice;
	}) => Record<string, unknown>;
	/** What PrismaLens relies on this agent to do, each with the versions it was checked on; absent, nothing. */
	facts?: AgentFacts;
	/** Each permission level on this agent (#673 w21 ruling 2026-10-10). */
	levels: Record<AccessLevel, LevelFacts>;
	/** The agent's own display name for each mode id a level uses, so no product shows a made-up label (#907). */
	modeNames: Readonly<Record<string, string>>;
	modeMechanism: ModeMechanism;
	/** Modes the agent runs under its OS sandbox with no network, per its source; a probe still decides `enforced`. */
	sandboxedModes?: readonly string[];
	/** `acp`: the session's own `model` config option; `unsupported`: a set model refuses the run. */
	modelVia: "acp" | "unsupported";
	/** ACP `authenticate` methods, first match wins; absent, the agent signs itself in (#1235). */
	authenticate?: readonly AuthenticateMethod[];
	/** Text in a refused `session/new` that means signed out, where the agent words it in its own terms. */
	signedOutText?: RegExp;
	/** Its handshake answers signed out: credentials are checked at the first prompt turn. */
	signInAtFirstTurn?: boolean;
	/** The host env var naming the model the agent runs when the host sets none. */
	envModelKey?: string;
	/** The env var that adds one model id to the agent's own list (#673 w57). */
	customModelEnvKey?: string;
	/** Provider env vars this agent reads from the host (ADR 0004 §3: an allowlist, never a wildcard). */
	providerKeys: readonly string[];
	/** The env var naming the agent's own config folder (#907). */
	configDir?: { envKey: string; shownDefault: string };
	/** The agent's documented keys for in-session sub-agent limits; absent, the agent sets its own. */
	subagentLimits?: {
		depth?: SubagentLimitKey;
		concurrency?: SubagentLimitKey;
	};
}

/** A finished run can be reopened with session/load or session/resume (#747). */
export const reopens = (row: Pick<AgentDescriptor, "facts">): boolean =>
	row.facts?.loadSession.value === true;

/** Every agent row, one file each under `agents/`; `registry.test.ts` holds this list to that folder. */
export const AGENT_ROWS = [
	opencode,
	claudeCode,
	codex,
	gemini,
	cursor,
	antigravity,
	copilot,
	kiro,
	grok,
	qwen,
	goose,
	deepagents,
	local,
] as const satisfies readonly AgentDescriptor[];

export const AGENT_REGISTRY: Readonly<Record<AgentId, AgentDescriptor>> =
	Object.fromEntries(
		AGENT_ROWS.map((r): [AgentId, AgentDescriptor] => [r.id, r]),
	) as Record<AgentId, AgentDescriptor>;
