// Ollama backend — local, no API key. Uses /api/chat with tools (requires a
// tool-capable local model, e.g. qwen2.5 or llama3.1). Demonstrates the swappable
// seam (ADR-0004): same loop, different backend, fully offline (ADR-0006).

import type { Message, ModelBackend, ModelResponse, ToolCall, ToolDef } from "../types.js";

interface OllamaMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
	tool_name?: string;
}

export interface OllamaOptions {
	host: string;
	model: string;
}

export function createOllamaBackend(opts: OllamaOptions): ModelBackend {
	const endpoint = `${opts.host.replace(/\/$/, "")}/api/chat`;
	return {
		id: `ollama:${opts.model}`,
		async complete(system, messages, tools): Promise<ModelResponse> {
			const ollamaMessages: OllamaMessage[] = [{ role: "system", content: system }];
			for (const m of messages) ollamaMessages.push(...toOllamaMessages(m));
			const res = await fetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					model: opts.model,
					messages: ollamaMessages,
					tools: tools.map(toOllamaTool),
					stream: false,
				}),
			});
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new Error(`Ollama ${res.status}: ${text}`);
			}
			const data = (await res.json()) as {
				message?: { content?: string; tool_calls?: { function: { name: string; arguments?: Record<string, unknown> } }[] };
			};
			const msg = data.message;
			// Guard against malformed tool calls with no function name (would otherwise
			// produce id "undefined-i" and silently fail the loop's name filters).
			const toolCalls: ToolCall[] = (msg?.tool_calls ?? [])
				.filter((tc) => typeof tc.function?.name === "string" && tc.function.name.length > 0)
				.map((tc, i) => ({
					id: `${tc.function.name}-${i}`,
					name: tc.function.name,
					args: tc.function.arguments ?? {},
				}));
			return { text: (msg?.content ?? "").trim(), toolCalls };
		},
	};
}

function toOllamaMessages(m: Message): OllamaMessage[] {
	if (m.role === "model") {
		const msg: OllamaMessage = { role: "assistant", content: m.text ?? "" };
		if (m.toolCalls?.length) {
			msg.tool_calls = m.toolCalls.map((tc) => ({ function: { name: tc.name, arguments: tc.args } }));
		}
		return [msg];
	}
	const out: OllamaMessage[] = [];
	if (m.text) out.push({ role: "user", content: m.text });
	for (const tr of m.toolResults ?? []) out.push({ role: "tool", content: tr.output, tool_name: tr.name });
	return out;
}

function toOllamaTool(t: ToolDef) {
	return { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } };
}
