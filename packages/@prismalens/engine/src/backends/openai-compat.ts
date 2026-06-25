// Universal OpenAI-compatible backend (the workhorse). Speaks /chat/completions with
// `tools:[{type:"function"}]` and tool_call_id matching. Works against any OpenAI-compatible
// endpoint: OpenAI, Groq, OpenRouter, LM Studio, **local Ollama (`/v1`)**, or Gemini's own
// OpenAI-compat endpoint. Local and remote are the same mechanism (the opencode model).

import { fetchWithRetry, sanitize } from "../http.js";
import type { Message, ModelBackend, ModelResponse, ToolCall } from "../types.js";

interface OpenAIToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}
interface OpenAIMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | null;
	tool_calls?: OpenAIToolCall[];
	tool_call_id?: string;
}

export interface OpenAICompatOptions {
	baseUrl: string;
	/** Optional — omitted for keyless local servers (e.g. Ollama). */
	apiKey?: string;
	model: string;
	/** Label for the backend id (e.g. "ollama", "groq"); defaults to "openai". */
	label?: string;
}

export function createOpenAICompatBackend(opts: OpenAICompatOptions): ModelBackend {
	const endpoint = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
	const apiKey = opts.apiKey ?? "";
	return {
		id: `${opts.label ?? "openai"}:${opts.model}`,
		async complete(system, messages, tools): Promise<ModelResponse> {
			const oa: OpenAIMessage[] = [{ role: "system", content: system }];
			for (const m of messages) oa.push(...toOpenAIMessages(m));
			const headers: Record<string, string> = { "content-type": "application/json" };
			if (apiKey) headers.authorization = `Bearer ${apiKey}`;
			const res = await fetchWithRetry(endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify({
					model: opts.model,
					messages: oa,
					tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
					tool_choice: "auto",
				}),
			});
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new Error(`OpenAI-compatible API ${res.status}: ${sanitize(text, apiKey)}`);
			}
			const data = (await res.json()) as {
				choices?: { message?: { content?: string | null; tool_calls?: OpenAIToolCall[] } }[];
			};
			const msg = data.choices?.[0]?.message;
			if (!msg) throw new Error("OpenAI-compatible API returned no choices.");
			const toolCalls: ToolCall[] = (msg.tool_calls ?? [])
				.filter((tc) => tc.function?.name)
				.map((tc) => ({ id: tc.id, name: tc.function.name, args: parseArgs(tc.function.arguments) }));
			return { text: (msg.content ?? "").trim(), toolCalls };
		},
	};
}

// OpenAI requires an assistant message's tool_calls[].id to match the following tool
// messages' tool_call_id — so ids are load-bearing here. The loop threads result.id = call.id.
function toOpenAIMessages(m: Message): OpenAIMessage[] {
	if (m.role === "model") {
		const msg: OpenAIMessage = { role: "assistant", content: m.text ?? "" };
		if (m.toolCalls?.length) {
			msg.content = m.text ?? null;
			msg.tool_calls = m.toolCalls.map((tc) => ({
				id: tc.id,
				type: "function",
				function: { name: tc.name, arguments: JSON.stringify(tc.args) },
			}));
		}
		return [msg];
	}
	const out: OpenAIMessage[] = [];
	if (m.text) out.push({ role: "user", content: m.text });
	for (const tr of m.toolResults ?? []) out.push({ role: "tool", tool_call_id: tr.id, content: tr.output });
	return out;
}

function parseArgs(raw: string): Record<string, unknown> {
	try {
		const v = JSON.parse(raw) as unknown;
		return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}
