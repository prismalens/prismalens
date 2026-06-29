/**
 * Claude Code harness runner (Tier-2 deep path, ADR-0008). Drives the Claude Agent
 * SDK (`query()` — which spawns the user's Claude Code CLI + subscription) and
 * yields the canonical event stream via {@link ClaudeCodeAdapter}.
 *
 * Headless + read-only: `permissionMode: "bypassPermissions"` (no interactive
 * prompts) with mutation tools blocked via `disallowedTools`. The Agent SDK's
 * `canUseTool` programmatic gate is the cleaner HITL seam for the act phase later
 * (ADR-0009); for Phase-1 read-only diagnosis the deny-list + bypass is enough.
 * The stream ALWAYS terminates (result → branch_done/error, or a thrown failure).
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CanonicalEvent } from "@prismalens/contracts";
import type { AdapterContext } from "../adapter/acp-adapter.js";
import {
	ClaudeCodeAdapter,
	type SdkMessage,
} from "../adapter/claude-code-adapter.js";

export interface ClaudeCodeConfig {
	/** Working directory the agent runs in (it reads the app source here). */
	cwd: string;
	/** The investigation prompt (first user turn). */
	prompt: string;
	/** Claude model id; omit to use the CLI/subscription default. */
	model?: string;
	/** Hard cap on agent turns (runaway guard). */
	maxTurns?: number;
	/** Tools the agent may NOT use. Default blocks mutation (read-only). */
	disallowedTools?: string[];
	/** External cancellation. */
	abortController?: AbortController;
}

const READ_ONLY_DENY = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

export async function* runClaudeCodeBranch(
	config: ClaudeCodeConfig,
	ctx: AdapterContext,
): AsyncGenerator<CanonicalEvent> {
	const adapter = new ClaudeCodeAdapter(ctx);
	let sawTerminal = false;
	try {
		const response = query({
			prompt: config.prompt,
			options: {
				cwd: config.cwd,
				...(config.model ? { model: config.model } : {}),
				// Behave as the real Claude Code harness (its tools + subagents).
				systemPrompt: { type: "preset", preset: "claude_code" },
				permissionMode: "bypassPermissions",
				disallowedTools: config.disallowedTools ?? READ_ONLY_DENY,
				...(config.maxTurns ? { maxTurns: config.maxTurns } : {}),
				...(config.abortController
					? { abortController: config.abortController }
					: {}),
			},
		});
		for await (const message of response) {
			const m = message as unknown as SdkMessage;
			for (const ev of adapter.normalize(m)) yield ev;
			if (m.type === "result") {
				sawTerminal = true;
				yield adapter.terminalFromResult(m);
			}
		}
		if (!sawTerminal) yield adapter.branchDone("submitted");
	} catch (err) {
		yield adapter.error(err instanceof Error ? err.message : String(err));
	}
}
