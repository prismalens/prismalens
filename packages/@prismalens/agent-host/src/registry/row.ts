// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** What every agent row shares: browser-safe helpers and the versions its probed facts were checked on. */
import type { AgentRunEnv, SubagentStopChoice } from "./agents.js";
import type { AgentFact, FactVersions } from "./facts.js";
import type { AccessLevel, LevelFacts } from "./levels.js";

export const SUBAGENTS_ON_STOP_DEFAULT: SubagentStopChoice = "stop";

/** The run file a `gatewayDelivery: "mcp-config-file"` row hands its agent. */
export const GATEWAY_RUN_FILE = "prismalens-mcp.json";

/** A base URL that is not Anthropic's own API host; an unreadable one counts as custom. */
export function customBaseUrl(url: string | undefined): boolean {
	if (!url) return false;
	try {
		return new URL(url).hostname.toLowerCase() !== "api.anthropic.com";
	} catch {
		return true;
	}
}

/** `configDir` joined without node:path, which this browser-safe module cannot import. */
export const inConfigDir = (env: AgentRunEnv, file: string) =>
	`${env.configDir}${env.configDir.includes("\\") ? "\\" : "/"}${file}`;

type ProbedValues = {
	[K in "loadSession" | "images" | "embeddedContext" | "directories"]: boolean;
};

/** A row's probed facts, all checked on the same versions: the nightly probe asserts them (#1101). */
export function probed(at: FactVersions, values: ProbedValues) {
	const fact = (value: boolean): AgentFact<boolean, "probe"> => ({
		value,
		via: "probe",
		verifiedAt: at,
	});
	return {
		loadSession: fact(values.loadSession),
		images: fact(values.images),
		embeddedContext: fact(values.embeddedContext),
		directories: fact(values.directories),
	};
}

/**
 * The versions each row's probed facts were last checked on, one line a row: the pin-bump
 * PR moves a line once its probe passed (`scripts/agent-facts.mjs sync`).
 */
export const PROBED_AT = {
	opencode: { cli: "1.19.6", adapter: null },
	"claude-code": { cli: "2.1.329", adapter: "0.109.0" },
	codex: { cli: "0.171.0", adapter: "2.8.0" },
	gemini: { cli: "0.65.0", adapter: null },
	// First read in deepagents-code main.py (load_sessions=True) and deepagents-acp server.py initialize; the probe holds them on the pin.
	deepagents: { cli: "0.2.1", adapter: null },
} as const satisfies Partial<Record<string, FactVersions>>;

export function noMode(): Record<AccessLevel, LevelFacts> {
	const facts: LevelFacts = { mode: null, mechanism: "none" };
	return {
		supervised: facts,
		"auto-edits": facts,
		auto: facts,
		"full-access": facts,
	};
}
