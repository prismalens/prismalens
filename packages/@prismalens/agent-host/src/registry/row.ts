// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** What every agent row shares: browser-safe helpers and the versions its probed facts were checked on. */
import type { AgentRunEnv, SubagentStopChoice } from "./agents.js";
import type { AgentFact } from "./facts.js";
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

/** A row's probed facts: the probe asserts them live on every pin and nightly on latest (#1082). */
export function probed(values: ProbedValues) {
	const fact = (value: boolean): AgentFact<boolean, "probe"> => ({
		value,
		via: "probe",
	});
	return {
		loadSession: fact(values.loadSession),
		images: fact(values.images),
		embeddedContext: fact(values.embeddedContext),
		directories: fact(values.directories),
	};
}

export function noMode(): Record<AccessLevel, LevelFacts> {
	const facts: LevelFacts = { mode: null, mechanism: "none" };
	return {
		supervised: facts,
		"auto-edits": facts,
		auto: facts,
		"full-access": facts,
	};
}
