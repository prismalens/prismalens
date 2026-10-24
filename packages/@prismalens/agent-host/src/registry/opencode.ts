// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isJsonObject, type JsonObject } from "./levels.js";

const OPENCODE_TOOLS = [
	"edit",
	"bash",
	"webfetch",
	"websearch",
	"external_directory",
] as const;
/** Tools OpenCode 1.18.30 types as one action, never a pattern map (core v1/config/permission.ts). */
const OPENCODE_ACTION_ONLY = new Set<string>(["webfetch", "websearch"]);
/** The built-in agents that run tools: the run's own, and the subagents it can start. */
const OPENCODE_AGENTS = ["build", "plan", "general", "explore"];

/** A user's rule for one tool: its patterns, and its catch-all only when it denies. */
function userPatterns(rule: unknown): JsonObject {
	if (rule === "deny") return { "*": "deny" };
	if (!isJsonObject(rule)) return {};
	const { "*": all, ...patterns } = rule;
	return all === "deny" ? { "*": "deny", ...patterns } : patterns;
}

/**
 * A level's catch-all per tool, with the user's own patterns listed again after it on every agent:
 * OpenCode uses the last matching rule and merges this file after theirs in their key order (#809).
 */
export function opencodePermission(
	edit: "ask" | "allow",
	rest: "ask" | "allow",
): (user: JsonObject) => JsonObject {
	const level: Record<(typeof OPENCODE_TOOLS)[number], string> = {
		edit,
		bash: rest,
		webfetch: rest,
		websearch: rest,
		external_directory: rest,
	};
	return (user) => {
		const top = isJsonObject(user.permission) ? user.permission : {};
		const agents = isJsonObject(user.agent) ? user.agent : {};
		const forAgent = (name: string) => {
			const own = agents[name];
			const rules =
				isJsonObject(own) && isJsonObject(own.permission) ? own.permission : {};
			return Object.fromEntries(
				OPENCODE_TOOLS.map((tool) => {
					const mine = rules[tool];
					if (OPENCODE_ACTION_ONLY.has(tool))
						return [
							tool,
							top[tool] === "deny" || mine === "deny" ? "deny" : level[tool],
						];
					// Their own map without "*" keeps its order, so the top-level catch-all stands in.
					const all =
						isJsonObject(mine) && !("*" in mine) ? {} : { "*": level[tool] };
					return [
						tool,
						{ ...all, ...userPatterns(top[tool]), ...userPatterns(mine) },
					];
				}),
			);
		};
		const names = new Set([...OPENCODE_AGENTS, ...Object.keys(agents)]);
		return {
			permission: Object.fromEntries(
				OPENCODE_TOOLS.map((tool) => [
					tool,
					OPENCODE_ACTION_ONLY.has(tool) ? level[tool] : { "*": level[tool] },
				]),
			),
			agent: Object.fromEntries(
				[...names].map((name) => [name, { permission: forAgent(name) }]),
			),
		};
	};
}
