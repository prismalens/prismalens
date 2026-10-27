// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Replaying a run's recorded PrismaLens tool calls (#848): against the tools, or as scripted-model fixtures. */
import { executeTool } from "./registry.js";
import { type HarnessTool, schemaHashOf } from "./tool.js";

/** A `harness_tool_call` event's recorded fields. */
export interface RecordedCall {
	name: string;
	callId?: string;
	input?: unknown;
	inputDropped?: boolean;
	output?: string;
	schemaHash?: string;
	via?: "tools_call";
}

export type ReplayResult =
	| {
			name: string;
			callId?: string;
			result: "same" | "differs";
			output: string;
	  }
	| {
			name: string;
			callId?: string;
			result: "unreplayable";
			reason: "input-dropped" | "schema-changed" | "tool-gone" | "not-recorded";
	  };

/**
 * Runs each recorded call again, in order, through `tools`. Pass record tools bound to a
 * fresh ledger, so a replay never writes to a real run.
 */
export async function replayCalls(
	calls: readonly RecordedCall[],
	tools: readonly HarnessTool[],
	runId: string,
): Promise<ReplayResult[]> {
	const signal = new AbortController().signal;
	const out: ReplayResult[] = [];
	for (const c of calls) {
		const id = c.callId ? { callId: c.callId } : {};
		const tool = tools.find((t) => t.name === c.name);
		const unreplayable = (
			reason: Extract<ReplayResult, { result: "unreplayable" }>["reason"],
		) => out.push({ name: c.name, ...id, result: "unreplayable", reason });
		if (!tool) unreplayable("tool-gone");
		else if (c.inputDropped) unreplayable("input-dropped");
		else if (c.input === undefined || c.output === undefined)
			unreplayable("not-recorded");
		else if (c.schemaHash && c.schemaHash !== schemaHashOf(tool))
			unreplayable("schema-changed");
		else {
			const call = await executeTool(tool, c.input, { runId, signal });
			out.push({
				name: c.name,
				...id,
				result: call.output === c.output ? "same" : "differs",
				output: call.output,
			});
		}
	}
	return out;
}

/** A scripted-model fixture entry (scripts/fakes/scenarios): our text only, never a request body. */
export interface FixtureEntry {
	match: Record<string, unknown>;
	response: { toolCalls: { name: string; arguments: unknown }[] };
}

/**
 * A run's calls as fixtures that make the scripted model call the same tools with the
 * same arguments, each after the previous one's result; `$gw:<tool>` resolves to the
 * name each agent gives PrismaLens's tool.
 */
export function fixturesFrom(
	calls: readonly RecordedCall[],
	marker: string,
): FixtureEntry[] {
	return calls
		.filter((c) => c.input !== undefined && !c.inputDropped)
		.map((c, i, kept) => ({
			match: {
				inConversation: marker,
				...(i === 0
					? { hasToolResult: false }
					: {
							afterTool: `$gw:${kept[i - 1]?.via === "tools_call" ? "tools_call" : kept[i - 1]?.name}`,
						}),
			},
			response: {
				toolCalls: [
					c.via === "tools_call"
						? {
								name: "$gw:tools_call",
								arguments: { name: c.name, arguments: c.input },
							}
						: { name: `$gw:${c.name}`, arguments: c.input },
				],
			},
		}));
}
