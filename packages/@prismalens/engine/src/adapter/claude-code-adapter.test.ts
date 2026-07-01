/**
 * ClaudeCodeAdapter unit tests — HERMETIC. No network, no real
 * `@anthropic-ai/claude-agent-sdk` query(): we feed hand-built SdkMessage objects
 * straight into the adapter and assert the SdkMessage → CanonicalEvent mapping,
 * validating every emitted event against the canonical schema.
 */
import { CanonicalEventSchema } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	ClaudeCodeAdapter,
	flattenContent,
	type SdkMessage,
} from "./claude-code-adapter.js";

const FIXED = new Date("2026-06-29T00:00:00.000Z");
const ctx = {
	runId: "11111111-1111-1111-1111-111111111111",
	branchId: "root",
	now: () => FIXED,
};

// --- fixture builders (hand-built SdkMessages; no SDK, no network) ---

function textMsg(text: string, parent?: string): SdkMessage {
	return {
		type: "assistant",
		...(parent ? { parent_tool_use_id: parent } : {}),
		message: { role: "assistant", content: [{ type: "text", text }] },
	};
}

function toolUseMsg(
	id: string,
	name: string,
	input?: Record<string, unknown>,
): SdkMessage {
	return {
		type: "assistant",
		message: {
			content: [{ type: "tool_use", id, name, ...(input ? { input } : {}) }],
		},
	};
}

function toolResultMsg(
	toolUseId: string,
	content: unknown,
	isError?: boolean,
): SdkMessage {
	return {
		type: "user",
		message: {
			content: [
				{
					type: "tool_result",
					tool_use_id: toolUseId,
					content,
					...(isError !== undefined ? { is_error: isError } : {}),
				},
			],
		},
	};
}

function assertValid(events: readonly unknown[]): void {
	for (const ev of events)
		expect(CanonicalEventSchema.safeParse(ev).success).toBe(true);
}

describe("flattenContent", () => {
	it("flattens strings, block arrays, single blocks, and nullish to text", () => {
		expect(flattenContent("plain")).toBe("plain");
		expect(
			flattenContent([
				{ type: "text", text: "x" },
				{ type: "text", text: "y" },
			]),
		).toBe("xy");
		expect(flattenContent({ text: "z" })).toBe("z");
		expect(flattenContent(undefined)).toBe("");
		expect(flattenContent(null)).toBe("");
	});
});

describe("ClaudeCodeAdapter.normalize", () => {
	it("maps an assistant text turn to one agent_step at the branch top", () => {
		const adapter = new ClaudeCodeAdapter(ctx);
		const events = adapter.normalize(textMsg("checking pods"));
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			kind: "agent_step",
			branchId: "root",
			path: [],
			seq: 0,
			label: null,
			text: "checking pods",
			toolCalls: [],
		});
		assertValid(events);
	});

	it("maps an assistant tool_use to an agent_step carrying the tool call", () => {
		const adapter = new ClaudeCodeAdapter(ctx);
		const events = adapter.normalize(
			toolUseMsg("tu_1", "Read", { file: "a.ts" }),
		);
		expect(events[0]).toMatchObject({
			kind: "agent_step",
			text: "",
			toolCalls: [{ toolCallId: "tu_1", name: "Read", args: { file: "a.ts" } }],
		});
		assertValid(events);
	});

	it("boxes a non-object tool_use input and defaults a missing one", () => {
		const raw: SdkMessage = {
			type: "assistant",
			message: {
				content: [
					{
						type: "tool_use",
						id: "tu_raw",
						name: "X",
						input: "raw" as unknown as Record<string, unknown>,
					},
				],
			},
		};
		const rawStep = new ClaudeCodeAdapter(ctx).normalize(raw)[0];
		if (rawStep.kind !== "agent_step") throw new Error("expected agent_step");
		expect(rawStep.toolCalls[0].args).toEqual({ value: "raw" });

		const bareStep = new ClaudeCodeAdapter(ctx).normalize(
			toolUseMsg("tu_2", "X"),
		)[0];
		if (bareStep.kind !== "agent_step") throw new Error("expected agent_step");
		expect(bareStep.toolCalls[0].args).toEqual({});
	});

	it("returns nothing for an assistant turn with no text and no tool_use", () => {
		const empty: SdkMessage = { type: "assistant", message: { content: [] } };
		expect(new ClaudeCodeAdapter(ctx).normalize(empty)).toEqual([]);
	});

	it("ignores message types other than assistant/user", () => {
		const sys: SdkMessage = { type: "system" };
		expect(new ClaudeCodeAdapter(ctx).normalize(sys)).toEqual([]);
	});

	it("returns nothing when a user message content is not an array", () => {
		const bad: SdkMessage = { type: "user", message: { content: "oops" } };
		expect(new ClaudeCodeAdapter(ctx).normalize(bad)).toEqual([]);
	});

	it("pairs a user tool_result with the earlier tool_use it answers", () => {
		const adapter = new ClaudeCodeAdapter(ctx);
		adapter.normalize(toolUseMsg("tu_1", "Read", { file: "a.ts" })); // seq 0, registers meta
		const events = adapter.normalize(toolResultMsg("tu_1", "file body"));
		expect(events[0]).toMatchObject({
			kind: "tool_result",
			result: {
				name: "Read",
				toolCategory: "file",
				ok: true,
				error: null,
				preview: "file body",
			},
		});
		assertValid(events);
	});

	it("marks an errored tool_result ok=false with error mirroring the preview", () => {
		const adapter = new ClaudeCodeAdapter(ctx);
		const events = adapter.normalize(toolResultMsg("tu_x", "NotFound", true));
		expect(events[0]).toMatchObject({
			kind: "tool_result",
			result: { ok: false, error: "NotFound", preview: "NotFound" },
		});
		assertValid(events);
	});

	it("falls back to a generic name/null category for an unknown tool_use_id", () => {
		const events = new ClaudeCodeAdapter(ctx).normalize(
			toolResultMsg("never-seen", "x"),
		);
		expect(events[0]).toMatchObject({
			kind: "tool_result",
			result: { name: "tool", toolCategory: null },
		});
		assertValid(events);
	});

	it("derives the tool category from the paired tool name", () => {
		const cases: Array<[string, "file" | "search" | null]> = [
			["Read", "file"],
			["Grep", "search"],
			["Bash", null],
		];
		for (const [name, category] of cases) {
			const adapter = new ClaudeCodeAdapter(ctx);
			adapter.normalize(toolUseMsg("tu", name));
			const events = adapter.normalize(toolResultMsg("tu", "out"));
			expect(events[0]).toMatchObject({
				kind: "tool_result",
				result: { name, toolCategory: category },
			});
			assertValid(events);
		}
	});

	it("truncates a preview longer than previewLimit and appends an ellipsis", () => {
		const adapter = new ClaudeCodeAdapter({ ...ctx, previewLimit: 5 });
		const events = adapter.normalize(toolResultMsg("tu", "abcdefgh"));
		const ev = events[0];
		if (ev.kind !== "tool_result") throw new Error("expected tool_result");
		expect(ev.result.preview).toHaveLength(6);
		expect(ev.result.preview.endsWith("…")).toBe(true);
		assertValid(events);
	});

	it("keeps seq monotonic across tool_use, tool_result, and terminal", () => {
		const adapter = new ClaudeCodeAdapter(ctx);
		const step = adapter.normalize(
			toolUseMsg("tu_1", "Read", { file: "a.ts" }),
		);
		const result = adapter.normalize(toolResultMsg("tu_1", "file body"));
		const done = adapter.terminalFromResult({
			type: "result",
			subtype: "success",
		});
		const events = [...step, ...result, done];
		expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
		assertValid(events);
	});
});

describe("ClaudeCodeAdapter depth (subagent tree)", () => {
	it("resolves label + path from the spawning Task tool-call", () => {
		const adapter = new ClaudeCodeAdapter(ctx);

		// A Task tool-call with subagent_type registers the human label.
		adapter.normalize(
			toolUseMsg("task_1", "Task", { subagent_type: "db-expert" }),
		);
		const child = adapter.normalize(textMsg("looking", "task_1"));
		expect(child[0]).toMatchObject({
			kind: "agent_step",
			label: "db-expert",
			path: ["db-expert"],
		});

		// A Task with only a description labels from the first 40 chars.
		const desc = "investigate the database connection pool timeouts";
		adapter.normalize(toolUseMsg("task_2", "Task", { description: desc }));
		const descChild = adapter.normalize(textMsg("digging", "task_2"));
		expect(descChild[0]).toMatchObject({ label: desc.slice(0, 40) });

		// An unregistered parent id falls back to the raw id.
		const orphan = adapter.normalize(textMsg("hmm", "ghost"));
		expect(orphan[0]).toMatchObject({ label: "ghost", path: ["ghost"] });

		assertValid([...child, ...descChild, ...orphan]);
	});
});

describe("ClaudeCodeAdapter.terminalFromResult", () => {
	it("maps result subtypes to the branch's terminal event", () => {
		const adapter = new ClaudeCodeAdapter(ctx);
		const success = adapter.terminalFromResult({
			type: "result",
			subtype: "success",
		});
		expect(success).toMatchObject({ kind: "branch_done", reason: "submitted" });

		const budget = adapter.terminalFromResult({
			type: "result",
			subtype: "error_max_turns",
		});
		expect(budget).toMatchObject({ kind: "branch_done", reason: "budget" });

		const boom = adapter.terminalFromResult({
			type: "result",
			subtype: "error_during_execution",
			result: "boom",
		});
		expect(boom).toMatchObject({ kind: "error", message: "boom" });

		const weird = adapter.terminalFromResult({
			type: "result",
			subtype: "weird",
		});
		if (weird.kind !== "error") throw new Error("expected error");
		expect(weird.message).toContain("weird");

		assertValid([success, budget, boom, weird]);
	});
});
