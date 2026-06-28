/**
 * Default Tier-2 harness: deepagents (ADR-0008).
 *
 * Thin builder over `createDeepAgent`. The model is INJECTED (BYO-key, ADR-0006)
 * — the engine never hard-binds a provider; the caller constructs the model
 * (Ollama, Gemini, …) and passes it in. The returned agent is a LangGraph
 * runnable; drive it with `agent.streamEvents(input, { version: "v2" })` and feed
 * the result to `runBranch`.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createDeepAgent } from "deepagents";

/** The compiled deepagents agent (LangGraph runnable). */
export type DeepAgentsHarness = ReturnType<typeof createDeepAgent>;

export interface DeepAgentsHarnessOptions {
	/** BYO model instance (e.g. ChatOllama). */
	model: BaseChatModel;
	/** Read-only SRE tools exposed to the harness (Slice 0: a small MCP set). */
	tools?: StructuredToolInterface[];
	/** Extra system prompt, combined with deepagents' base prompt. */
	systemPrompt?: string;
}

export function createDeepAgentsHarness(
	opts: DeepAgentsHarnessOptions,
): DeepAgentsHarness {
	return createDeepAgent({
		model: opts.model,
		tools: opts.tools ?? [],
		...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
	});
}

/** The run input shape deepagents (createReactAgent-style) expects. */
export interface HarnessRunInput {
	messages: Array<{ role: "user" | "system" | "assistant"; content: string }>;
}
