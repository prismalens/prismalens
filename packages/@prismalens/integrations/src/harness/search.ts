// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Tool search: a small core is listed, other `read` tools are found with `tools_search`
 * and run with `tools_call`. No `list_changed`: two of the agents ignore it, and the
 * gateway has no stream to send it on.
 */
import { z } from "zod";
import type { RunView } from "./registry.js";
import {
	defineHarnessTool,
	EVERY_SUBJECT,
	fail,
	type HarnessTool,
	inputSchemaOf,
} from "./tool.js";

export const TOOLS_SEARCH = "tools_search";
export const TOOLS_CALL = "tools_call";

/** Which of `tools` a run gets, and how: every one listed, or a core plus search. */
export function runView(
	tools: readonly HarnessTool[],
	{ search }: { search: boolean },
): RunView {
	if (!search) return { direct: tools, deferred: [] };
	const deferred = tools.filter(
		(t) => t.effect === "read" && t.group === "knowledge",
	);
	if (!deferred.length) return { direct: tools, deferred: [] };
	const direct = tools.filter((t) => !deferred.includes(t));
	return {
		direct: [...direct, searchTool(deferred), callTool(deferred)],
		deferred,
	};
}

/**
 * Tools the agent may run without its own card: `read` and `record` touch only PrismaLens's
 * records, and an `act` tool is gated by PrismaLens's card, which a bypassed prompt cannot skip.
 * A tool that runs code is left to the run's level, as a shell command is (#1061).
 */
export const autoAllowed = (view: RunView): string[] =>
	[...view.direct, ...view.deferred]
		.filter((t) => !t.runsCode)
		.map((t) => t.name);

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

function score(tool: HarnessTool, query: string[]): number {
	const name = new Set(words(tool.name));
	const rest = new Set(
		words(`${tool.title} ${tool.description} ${tool.group}`),
	);
	return query.reduce(
		(n, w) => n + (name.has(w) ? 3 : 0) + (rest.has(w) ? 1 : 0),
		0,
	);
}

function searchTool(deferred: readonly HarnessTool[]): HarnessTool {
	return defineHarnessTool({
		name: TOOLS_SEARCH,
		title: "Find more PrismaLens tools",
		description: `Find PrismaLens tools that are not listed up front, by what you want to do (e.g. "past incidents", "runbooks"). Use it before guessing a tool name. Returns each match's name, description and input schema; run one with ${TOOLS_CALL}. Not for tools already listed. Show the user links, not ids. On failure, follow \`next\`.`,
		group: "core",
		effect: "read",
		serves: { subjects: EVERY_SUBJECT },
		input: z.object({
			query: z.string().trim().min(1).max(200),
			limit: z.number().int().min(1).max(8).default(5),
		}),
		run: async ({ query, limit }) => {
			const q = words(query);
			const found = deferred
				.map((t) => ({ t, s: score(t, q) }))
				.filter((m) => m.s > 0)
				.sort((a, b) => b.s - a.s)
				.slice(0, limit)
				.map(({ t }) => ({
					name: t.name,
					description: t.description,
					inputSchema: inputSchemaOf(t),
				}));
			return {
				value: found.length
					? {
							tools: found,
							run: `Call ${TOOLS_CALL} with {"name", "arguments"}.`,
						}
					: {
							tools: [],
							available: deferred.map((t) => t.name),
							next: "No match; search again with one of these names.",
						},
			};
		},
	});
}

function callTool(deferred: readonly HarnessTool[]): HarnessTool {
	return defineHarnessTool({
		name: TOOLS_CALL,
		title: "Run a PrismaLens tool found by search",
		description: `Run a tool ${TOOLS_SEARCH} returned: pass its exact \`name\` and its \`arguments\` as its input schema describes. Use it only for a name ${TOOLS_SEARCH} gave you. Not for listed tools: call those directly. Show the user links, not ids. On failure, follow \`next\`.`,
		group: "core",
		effect: "read",
		serves: { subjects: EVERY_SUBJECT },
		input: z.object({
			name: z.string().trim().min(1).max(64),
			arguments: z.record(z.string(), z.unknown()).default({}),
		}),
		// The gateway resolves the target and runs it as itself (`resolveCall`).
		run: async ({ name }) =>
			fail(
				"not_found",
				`"${name}" is not a PrismaLens tool this run can call.`,
				`Use a name ${TOOLS_SEARCH} returned: ${deferred.map((t) => t.name).join(", ")}.`,
			),
	});
}

/**
 * Which tool a `tools/call` runs, and with what arguments: a listed tool as itself,
 * `tools_call` as its `read` target in the view. `undefined` is an unknown tool, a
 * protocol error (MCP `/server/tools` Error Handling).
 */
export function resolveCall(
	view: RunView,
	name: string,
	args: unknown,
): { tool: HarnessTool; args: unknown } | undefined {
	const listed = view.direct.find((t) => t.name === name);
	if (!listed) return undefined;
	if (name !== TOOLS_CALL) return { tool: listed, args };
	const parsed = listed.input.safeParse(args ?? {});
	if (!parsed.success) return { tool: listed, args };
	const target = [...view.deferred, ...view.direct].find(
		(t) =>
			t.name === parsed.data.name &&
			t.effect === "read" &&
			t.name !== TOOLS_CALL &&
			t.name !== TOOLS_SEARCH,
	);
	return target
		? { tool: target, args: parsed.data.arguments }
		: { tool: listed, args };
}
