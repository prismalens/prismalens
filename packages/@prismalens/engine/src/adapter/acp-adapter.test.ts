// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { CanonicalEventSchema } from "@prismalens/contracts/schemas";
import { describe, expect, it } from "vitest";
import {
	AcpAdapter,
	type AcpUpdate,
	askDetail,
	deriveSource,
	flattenAcpContent,
	mapStopReason,
	mapToolCategory,
	pickName,
	RULE_DENIED,
	unwrapInput,
} from "./acp-adapter.js";

const FIXED = new Date("2026-06-29T00:00:00.000Z");
const ctx = {
	runId: "11111111-1111-4111-8111-111111111111",
	branchId: "root",
	now: () => FIXED,
};

// Shapes copied verbatim from the live ACP captures (/tmp/acp.jsonl, /tmp/acp2.jsonl).
const lsToolCall: AcpUpdate = {
	sessionUpdate: "tool_call",
	kind: "search",
	status: "pending",
	title: "ls",
	toolCallId: "call_ze0og9u5",
};
const lsToolUpdate: AcpUpdate = {
	sessionUpdate: "tool_call_update",
	toolCallId: "call_ze0og9u5",
	status: "completed",
	content: [
		{ type: "content", content: { type: "text", text: "['a.ts','b.ts']" } },
	],
};
const execToolCall: AcpUpdate = {
	sessionUpdate: "tool_call",
	kind: "execute",
	status: "pending",
	title: "Execute: `ls -la`",
	toolCallId: "call_gp6m6ma9",
	rawInput: { command: "ls -la", timeout: null },
};

describe("helpers", () => {
	it("flattenAcpContent handles the chunk object and the tool-update array", () => {
		expect(flattenAcpContent({ type: "text", text: "Found" })).toBe("Found");
		expect(
			flattenAcpContent([
				{ type: "content", content: { type: "text", text: "x" } },
				{ type: "content", content: { type: "text", text: "y" } },
			]),
		).toBe("xy");
		expect(flattenAcpContent(undefined)).toBe("");
		expect(flattenAcpContent("plain")).toBe("plain");
	});

	it("pickName prefers title, falls back to kind then a generic", () => {
		expect(
			pickName({ sessionUpdate: "tool_call", title: "ls", kind: "search" }),
		).toBe("ls");
		expect(pickName({ sessionUpdate: "tool_call", kind: "execute" })).toBe(
			"execute",
		);
		expect(pickName({ sessionUpdate: "tool_call" })).toBe("tool");
	});

	it("unwrapInput unwraps a {input:'<json>'} wrapper and passes others through", () => {
		expect(unwrapInput({ input: '{"namespace":"prod"}' })).toEqual({
			namespace: "prod",
		});
		expect(unwrapInput({ namespace: "prod" })).toEqual({ namespace: "prod" });
		expect(unwrapInput({ input: "not json" })).toEqual({ input: "not json" });
	});

	it("deriveSource renders tool + input", () => {
		expect(deriveSource("ls", { command: "ls -la", timeout: null })).toBe(
			'ls({"command":"ls -la","timeout":null})',
		);
		expect(deriveSource("ls", undefined)).toBe("ls");
	});

	it("mapToolCategory maps known ACP kinds and nulls the rest", () => {
		expect(mapToolCategory("search")).toBe("search");
		expect(mapToolCategory("read")).toBe("file");
		expect(mapToolCategory("execute")).toBeNull();
		expect(mapToolCategory(undefined)).toBeNull();
	});

	it("mapStopReason classifies completion reasons", () => {
		expect(mapStopReason("end_turn")).toBe("submitted");
		expect(mapStopReason("max_tokens")).toBe("budget");
		expect(mapStopReason("max_turn_requests")).toBe("budget");
		expect(mapStopReason("refusal")).toBe("no_progress");
		expect(mapStopReason(undefined)).toBe("no_progress");
	});

	it("askDetail returns rawInput.command (string, and string[] joined by space)", () => {
		expect(askDetail({ command: "git status" })).toBe("git status");
		expect(askDetail({ command: ["git", "status", "-s"] })).toBe(
			"git status -s",
		);
	});

	it("askDetail falls back to file_path, filePath, path, or locations[0].path, else null", () => {
		expect(askDetail({ file_path: "src/a.ts" })).toBe("src/a.ts");
		expect(askDetail({ filePath: "src/b.ts" })).toBe("src/b.ts");
		expect(askDetail({ path: "src/c.ts" })).toBe("src/c.ts");
		expect(askDetail({}, [{ path: "src/d.ts" }])).toBe("src/d.ts");
		expect(askDetail({})).toBeNull();
		expect(askDetail(null)).toBeNull();
	});

	it("askDetail truncates at 2000 chars", () => {
		const long = "x".repeat(2500);
		const result = askDetail({ command: long });
		expect(result).toHaveLength(2000);
		expect(result).toBe("x".repeat(2000));
	});
});

describe("AcpAdapter.normalize", () => {
	it("accumulates message chunks and flushes them on the next tool_call", () => {
		const adapter = new AcpAdapter(ctx);
		expect(
			adapter.normalize({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "checking " },
			}),
		).toBeNull();
		expect(
			adapter.normalize({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "pods" },
			}),
		).toBeNull();
		const step = adapter.normalize(lsToolCall);
		expect(step).toMatchObject({
			kind: "agent_step",
			runId: ctx.runId,
			branchId: "root",
			path: [],
			seq: 0,
			label: null,
			text: "checking pods",
			toolCalls: [{ toolCallId: "call_ze0og9u5", name: "ls", args: {} }],
			ts: FIXED.toISOString(),
		});
		expect(CanonicalEventSchema.safeParse(step).success).toBe(true);
	});

	it("carries rawInput into the agent_step toolCalls args", () => {
		const adapter = new AcpAdapter(ctx);
		const step = adapter.normalize(execToolCall);
		expect(step).toMatchObject({
			kind: "agent_step",
			toolCalls: [
				{
					toolCallId: "call_gp6m6ma9",
					name: "Execute: `ls -la`",
					args: { command: "ls -la", timeout: null },
				},
			],
		});
		expect(CanonicalEventSchema.safeParse(step).success).toBe(true);
	});

	it("pairs a completed tool_call_update into a tool_result using the call's title", () => {
		const adapter = new AcpAdapter(ctx);
		adapter.normalize(lsToolCall); // seq 0 — registers the title/kind
		const result = adapter.normalize(lsToolUpdate);
		expect(result).toMatchObject({
			kind: "tool_result",
			seq: 1,
			result: {
				name: "ls",
				toolCategory: "search",
				toolCallId: "call_ze0og9u5",
				source: "ls",
				ok: true,
				error: null,
				preview: "['a.ts','b.ts']",
			},
		});
		expect(CanonicalEventSchema.safeParse(result).success).toBe(true);
	});

	it("previews Codex's rawOutput when the update carries no content", () => {
		const adapter = new AcpAdapter(ctx);
		adapter.normalize({
			sessionUpdate: "tool_call",
			toolCallId: "call_cx",
			kind: "execute",
			title: "rg --files",
			rawInput: { command: "rg --files", cwd: "/r" },
		});
		const result = adapter.normalize({
			sessionUpdate: "tool_call_update",
			toolCallId: "call_cx",
			status: "completed",
			rawOutput: { formatted_output: "a.ts\nb.ts\n", exit_code: 0 },
		});
		expect(result).toMatchObject({
			kind: "tool_result",
			result: { ok: true, preview: "a.ts\nb.ts\n" },
		});
	});

	it("caps a Codex rawOutput preview and reads MCP results", () => {
		const capped = new AcpAdapter({ ...ctx, previewLimit: 5 });
		const r = capped.normalize({
			sessionUpdate: "tool_call_update",
			toolCallId: "c1",
			status: "completed",
			rawOutput: { formatted_output: "0123456789", exit_code: 0 },
		});
		expect(r).toMatchObject({ result: { preview: "01234…" } });
		const mcp = new AcpAdapter(ctx).normalize({
			sessionUpdate: "tool_call_update",
			toolCallId: "c2",
			status: "completed",
			rawOutput: {
				result: { content: [{ type: "text", text: "pong" }] },
				error: null,
			},
		});
		expect(mcp).toMatchObject({ result: { preview: "pong" } });
	});

	it("keeps Claude content ahead of rawOutput", () => {
		const r = new AcpAdapter(ctx).normalize({
			sessionUpdate: "tool_call_update",
			toolCallId: "c3",
			status: "completed",
			content: [{ type: "content", content: { type: "text", text: "from content" } }],
			rawOutput: { formatted_output: "from raw" },
		});
		expect(r).toMatchObject({ result: { preview: "from content" } });
	});

	it("keeps output an earlier update carried when the completed update is bare", () => {
		const adapter = new AcpAdapter(ctx);
		adapter.normalize({
			sessionUpdate: "tool_call",
			toolCallId: "c4",
			kind: "execute",
			title: "Terminal",
			rawInput: { command: "ls" },
		});
		adapter.normalize({
			sessionUpdate: "tool_call_update",
			toolCallId: "c4",
			status: "in_progress",
			rawOutput: { formatted_output: "a.ts" },
		});
		const r = adapter.normalize({
			sessionUpdate: "tool_call_update",
			toolCallId: "c4",
			status: "completed",
		});
		expect(r).toMatchObject({ result: { preview: "a.ts" } });
	});

	it("shows the command Claude Code sends after opening the call empty (walk f16)", () => {
		const adapter = new AcpAdapter(ctx);
		adapter.normalize({
			sessionUpdate: "tool_call",
			toolCallId: "toolu_1",
			kind: "execute",
			title: "Terminal",
			rawInput: {},
		});
		adapter.normalize({
			sessionUpdate: "tool_call_update",
			toolCallId: "toolu_1",
			status: "in_progress",
			title: "`curl -s http://localhost:9090/api/v1/rules`",
			rawInput: { command: "curl -s http://localhost:9090/api/v1/rules" },
		});
		const result = adapter.normalize({
			sessionUpdate: "tool_call_update",
			toolCallId: "toolu_1",
			status: "completed",
		});
		expect(result).toMatchObject({
			kind: "tool_result",
			result: {
				name: "`curl -s http://localhost:9090/api/v1/rules`",
				source:
					'`curl -s http://localhost:9090/api/v1/rules`({"command":"curl -s http://localhost:9090/api/v1/rules"})',
			},
		});
	});

	it("previews an MCP result that Codex sends only as rawOutput (#848)", () => {
		const adapter = new AcpAdapter(ctx);
		adapter.normalize({
			sessionUpdate: "tool_call",
			toolCallId: "exec-1",
			kind: "execute",
			title: "mcp.prismalens.sources_list",
			rawInput: { server: "prismalens", tool: "sources_list", arguments: {} },
		});
		// codex-acp 1.13.1 createMcpRawOutput: { result, error }, no `content`.
		const result = adapter.normalize({
			sessionUpdate: "tool_call_update",
			toolCallId: "exec-1",
			status: "completed",
			rawOutput: {
				result: { content: [{ type: "text", text: '{"status":"removed"}' }] },
				error: null,
			},
		});
		expect(result).toMatchObject({
			kind: "tool_result",
			result: { ok: true, preview: '{"status":"removed"}' },
		});
		const failed = adapter.normalize({
			sessionUpdate: "tool_call_update",
			toolCallId: "exec-1",
			status: "failed",
			rawOutput: { result: null, error: { message: "upstream refused" } },
		});
		expect(failed).toMatchObject({
			result: { ok: false, error: "upstream refused" },
		});
	});

	it("marks a failed tool_call_update ok=false with the error preview", () => {
		const adapter = new AcpAdapter(ctx);
		adapter.normalize({ ...lsToolCall, title: "kubectl get", kind: "execute" });
		const result = adapter.normalize({
			sessionUpdate: "tool_call_update",
			toolCallId: "call_ze0og9u5",
			status: "failed",
			content: [
				{ type: "content", content: { type: "text", text: "NotFound" } },
			],
		});
		expect(result).toMatchObject({
			kind: "tool_result",
			result: {
				name: "kubectl get",
				ok: false,
				error: "NotFound",
				preview: "NotFound",
			},
		});
		expect(CanonicalEventSchema.safeParse(result).success).toBe(true);
	});

	it("ignores non-terminal tool progress frames and unsurfaced updates", () => {
		const adapter = new AcpAdapter(ctx);
		expect(
			adapter.normalize({
				sessionUpdate: "tool_call_update",
				toolCallId: "x",
				status: "in_progress",
			}),
		).toBeNull();
		expect(
			adapter.normalize({
				sessionUpdate: "agent_thought_chunk",
				content: { text: "hmm" },
			}),
		).toBeNull();
		expect(adapter.normalize({ sessionUpdate: "plan" })).toBeNull();
	});

	it("returns null for an unknown update and does not throw", () => {
		const adapter = new AcpAdapter(ctx);
		const unknownUpdate: AcpUpdate = {
			sessionUpdate: "unrecognized_session_update_kind",
			kind: "unrecognized_tool_kind",
			rawInput: { extra: true },
		};
		expect(() => adapter.normalize(unknownUpdate)).not.toThrow();
		expect(adapter.normalize(unknownUpdate)).toBeNull();
	});

	it("flushText emits trailing text as a text-only agent_step", () => {
		const adapter = new AcpAdapter(ctx);
		adapter.normalize({
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "done." },
		});
		const flushed = adapter.flushText();
		expect(flushed).toMatchObject({
			kind: "agent_step",
			text: "done.",
			toolCalls: [],
		});
		expect(adapter.flushText()).toBeNull(); // nothing left
	});

	it("keeps seq monotonic across normalize + terminal events, all schema-valid", () => {
		const adapter = new AcpAdapter(ctx);
		const step = adapter.normalize(lsToolCall); // 0
		const result = adapter.normalize(lsToolUpdate); // 1
		const done = adapter.branchDone("submitted"); // 2
		const report = adapter.report({
			summary: "ordered-evidence report",
			rootCause: null,
			rootCauseCategory: null,
			hypotheses: [],
			ruledOut: [],
			coverage: { queried: [], notQueried: [] },
			nextSteps: [],
		}); // 3
		expect([step?.seq, result?.seq, done.seq, report.seq]).toEqual([
			0, 1, 2, 3,
		]);
		for (const ev of [step, result, done, report]) {
			expect(CanonicalEventSchema.safeParse(ev).success).toBe(true);
		}
	});

	it("permissionAsk falls back to earlier tool_call rawInput and title when the ask has none", () => {
		const adapter = new AcpAdapter(ctx);
		adapter.normalize({
			sessionUpdate: "tool_call",
			toolCallId: "call_earlier",
			title: "Earlier Tool Title",
			kind: "execute",
			rawInput: { command: "npm test" },
		});
		const askId = "22222222-2222-4222-8222-222222222222";
		const event = adapter.permissionAsk(
			askId,
			{ toolCallId: "call_earlier" },
			new Date("2026-06-29T00:05:00.000Z"),
		);
		expect(event).toMatchObject({
			kind: "permission_ask",
			askId,
			title: "Earlier Tool Title",
			detail: "npm test",
			toolKind: "execute",
			expiresAt: "2026-06-29T00:05:00.000Z",
		});
		expect(CanonicalEventSchema.safeParse(event).success).toBe(true);
	});
});

describe("a call Claude Code's own rules refused (#673 w7-6)", () => {
	it("Given a permission-rule failure, Then the result says a rule denied it, not the user", () => {
		const adapter = new AcpAdapter(ctx);
		adapter.events({ ...execToolCall, toolCallId: "t_rule" });
		// The live frame from walk 7 (build 83ce2d3), trimmed to what it carries.
		const [result] = adapter.events({
			sessionUpdate: "tool_call_update",
			toolCallId: "t_rule",
			status: "failed",
			_meta: {
				claudeCode: { toolName: "Bash", nonExecutionKind: "permission-rule" },
			},
			content: [
				{
					type: "content",
					content: {
						type: "text",
						text: "Permission to use Bash with command npm run dev has been denied.",
					},
				},
			],
		});
		expect(result).toMatchObject({
			kind: "tool_result",
			result: { ok: false, error: RULE_DENIED, preview: RULE_DENIED },
		});
	});
});

describe("ACP status semantics (#820, #673 w5-2)", () => {
	const open: AcpUpdate = {
		sessionUpdate: "tool_call",
		toolCallId: "toolu_1",
		kind: "execute",
		title: "Terminal",
		rawInput: {},
	};

	it("reads a status-less update as the call still running, and shows the command it fills in", () => {
		const adapter = new AcpAdapter(ctx);
		adapter.events(open);
		const filled = adapter.events({
			sessionUpdate: "tool_call_update",
			toolCallId: "toolu_1",
			title: "curl -s http://localhost:9093/api/v2/alerts",
			rawInput: { command: "curl -s http://localhost:9093/api/v2/alerts" },
		});
		expect(filled).toHaveLength(1);
		expect(filled[0]).toMatchObject({
			kind: "agent_step",
			text: "",
			toolCalls: [
				{
					toolCallId: "toolu_1",
					args: { command: "curl -s http://localhost:9093/api/v2/alerts" },
				},
			],
		});
		// A field streamed in later fills the step in too; the same input again is nothing new.
		const fuller = {
			command: "curl -s http://localhost:9093/api/v2/alerts",
			description: "Read alerts",
		};
		expect(
			adapter.events({
				sessionUpdate: "tool_call_update",
				toolCallId: "toolu_1",
				rawInput: fuller,
			}),
		).toMatchObject([{ kind: "agent_step", toolCalls: [{ args: fuller }] }]);
		expect(
			adapter.events({
				sessionUpdate: "tool_call_update",
				toolCallId: "toolu_1",
				rawInput: fuller,
			}),
		).toEqual([]);
		const done = adapter.events({
			sessionUpdate: "tool_call_update",
			toolCallId: "toolu_1",
			status: "failed",
			content: [{ type: "content", content: { type: "text", text: "denied" } }],
		});
		expect(done).toHaveLength(1);
		expect(done[0]).toMatchObject({ kind: "tool_result", result: { ok: false } });
	});

	it("ends a call announced already finished", () => {
		const adapter = new AcpAdapter(ctx);
		const out = adapter.events({
			sessionUpdate: "tool_call",
			toolCallId: "img_1",
			kind: "read",
			title: "View image",
			status: "completed",
		});
		expect(out.map((e) => e.kind)).toEqual(["agent_step", "tool_result"]);
		for (const e of out) expect(CanonicalEventSchema.safeParse(e).success).toBe(true);
	});

	it("puts the call id, the input and the MCP server on an ask for a tool with no command (#673 w5-41)", () => {
		const adapter = new AcpAdapter(ctx);
		const ask = adapter.permissionAsk(
			"5f1d7a52-7a43-4f43-9f43-6a1a4b5c2d10",
			{
				toolCallId: "toolu_9",
				title: "mcp__plugin_context-mode_context-mode__ctx_batch_execute",
				kind: "other",
				rawInput: { commands: ["git log -5"], queries: ["pool size"] },
				_meta: { claudeCode: { mcpServer: { name: "context-mode", source: "plugin" } } },
			},
			FIXED,
		);
		expect(ask).toMatchObject({
			kind: "permission_ask",
			toolCallId: "toolu_9",
			detail: null,
			server: "context-mode",
		});
		expect(ask.kind === "permission_ask" && JSON.parse(ask.input ?? "")).toEqual({
			commands: ["git log -5"],
			queries: ["pool size"],
		});
		expect(CanonicalEventSchema.safeParse(ask).success).toBe(true);
	});

	it("records a queued message and carries its id onto the delivery", () => {
		const adapter = new AcpAdapter(ctx);
		const id = "0d4f6f0e-3c1e-4f7e-9a51-2b1f6d1e9c11";
		const queued = adapter.messageQueued(id, "check the pool");
		const delivered = adapter.operatorMessage(
			"check the pool",
			"queue",
			true,
			undefined,
			undefined,
			undefined,
			id,
		);
		expect(queued).toMatchObject({ kind: "message_queued", messageId: id });
		expect(delivered).toMatchObject({ kind: "operator_message", messageId: id });
		expect(CanonicalEventSchema.safeParse(queued).success).toBe(true);
	});
});
