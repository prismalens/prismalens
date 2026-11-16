// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Pure data and pure functions: no `node:` import, safe for the browser. */
import { AGENT_IDS, AGENT_REGISTRY, type AgentId } from "./agents.js";
import { ACCESS_LEVELS, type AccessLevel, type LevelFacts } from "./levels.js";

export * from "./agents.js";
export * from "./levels.js";
export { opencodePermission } from "./opencode.js";

/** A mode by id and the agent's own display name for it. */
export interface NamedMode {
	id: string;
	name: string;
}

/** One level on one agent, its modes named by the agent's own words. */
export interface ResolvedLevel {
	level: AccessLevel;
	/** Null when the agent has no modes and the host answers each ask. */
	mode: NamedMode | null;
	fallback: NamedMode | null;
	mechanism: string;
	configPatch?: LevelFacts["configPatch"];
}

/** Each agent's display name per mode id, so neither product shows a made-up label (#907). */
export const MODE_NAMES: Readonly<
	Record<AgentId, Readonly<Record<string, string>>>
> = Object.fromEntries(
	AGENT_IDS.map((id) => [id, AGENT_REGISTRY[id].modeNames]),
) as Record<AgentId, Readonly<Record<string, string>>>;

/** The agent's own name for `modeId`, preferring what its last probe offered. */
export function modeName(
	agent: AgentId,
	modeId: string,
	offered?: readonly NamedMode[] | null,
): string | null {
	return (
		offered?.find((m) => m.id === modeId)?.name ??
		AGENT_REGISTRY[agent].modeNames[modeId] ??
		null
	);
}

function named(
	agent: AgentId,
	id: string | null | undefined,
	offered?: readonly NamedMode[] | null,
): NamedMode | null {
	if (!id) return null;
	const name = modeName(agent, id, offered);
	if (!name) throw new Error(`${agent} has no display name for mode ${id}`);
	return { id, name };
}

export function resolveLevel(
	agent: AgentId,
	level: AccessLevel,
	offered?: readonly NamedMode[] | null,
): ResolvedLevel {
	const facts = AGENT_REGISTRY[agent].levels[level];
	return {
		level,
		mode: named(agent, facts.mode, offered),
		fallback: named(agent, facts.fallbackMode, offered),
		mechanism: facts.mechanism,
		...(facts.configPatch ? { configPatch: facts.configPatch } : {}),
	};
}

/** The first level whose mode is `modeId`; null for an id no level sets. */
export function levelOfAgentMode(
	agent: AgentId,
	modeId: string | null,
): AccessLevel | null {
	if (!modeId) return null;
	const row = AGENT_REGISTRY[agent];
	return ACCESS_LEVELS.find((l) => row.levels[l].mode === modeId) ?? null;
}

/** Env names the host sets itself on this agent's child; Settings refuses them as stored values (#907). */
export function reservedEnvNames(agent: AgentId): string[] {
	const d = AGENT_REGISTRY[agent];
	const names = new Set(
		Object.keys(
			d.acpEnv({
				configDir: "x",
				dataDir: "x",
				cwd: "x",
				companionPath: "x",
				shipped: true,
			}),
		),
	);
	if (d.configDir) names.add(d.configDir.envKey);
	if (d.customModelEnvKey) names.add(d.customModelEnvKey);
	return [...names];
}

/** Whether the agent runs `mode` under its own OS sandbox at all; whether that sandbox works here is a probe's call. */
export function runsInSandbox(agent: AgentId, mode: string | null): boolean {
	const sandboxed = AGENT_REGISTRY[agent].sandboxedModes ?? [];
	return !!mode && sandboxed.includes(mode);
}
