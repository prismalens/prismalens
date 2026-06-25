// OpenAI-compatible backend — a genuinely DIFFERENT adapter/protocol from Gemini's
// native REST (uses /chat/completions, `tools:[{type:"function"}]`, and tool_call_id
// matching). Works against any OpenAI-compatible endpoint: real OpenAI, Groq,
// OpenRouter, LM Studio — or **Gemini's own OpenAI-compatibility endpoint**, which lets
// us prove the swappable seam (ADR-0004) with the SAME free Gemini key, no new account.

import { fetchWithRetry } from "./gemini.js";
import type { Message, ModelBackend, ModelResponse, ToolCall, ToolDef } from "../types.js";

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

export interface OpenAIOptions {
	baseUrl: string;
	apiKey: string;
	model: string;
}

export function createOpenAIBackend(opts: OpenAIOptions): ModelBackend {
	const endpoint = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
	return {
		id: `openai:${opts.model}`,
		async complete(system, messages, tools): Promise<ModelResponse> {
			const oa: OpenAIMessage[] = [{ role: "system", content: system }];
			for (const m of messages) oa.push(...toOpenAIMessages(m));
			const res = await fetchWithRetry(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
				body: JSON.stringify({
					model: opts.model,
					messages: oa,
					tools: tools.map((t) => ({
						type: "function",
						function: { name: t.name, description: t.description, parameters: t.parameters },
					})),
					tool_choice: "auto",
				}),
			});
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new Error(`OpenAI-compatible API ${res.status}: ${sanitize(text, opts.apiKey)}`);
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
// messages' tool_call_id — so unlike Gemini, ids here are load-bearing. Our loop already
// threads result.id = call.id, so the ids line up across the turn.
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

function sanitize(s: string, key: string): string {
	return key ? s.split(key).join("[REDACTED]") : s;
}
