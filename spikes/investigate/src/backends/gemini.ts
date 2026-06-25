// Gemini backend — calls the v1beta generateContent REST endpoint directly (no SDK).
// The API key goes in the `x-goog-api-key` HEADER (never the URL), so it cannot leak
// into request logs; error bodies are additionally sanitized.

import type { Message, ModelBackend, ModelResponse, ToolCall, ToolDef } from "../types.js";

interface GeminiPart {
	text?: string;
	functionCall?: { name: string; args?: Record<string, unknown> };
	functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiContent {
	role: "user" | "model";
	parts: GeminiPart[];
}

export interface GeminiOptions {
	apiKey: string;
	model: string;
}

export function createGeminiBackend(opts: GeminiOptions): ModelBackend {
	const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent`;
	return {
		id: `gemini:${opts.model}`,
		async complete(system, messages, tools): Promise<ModelResponse> {
			const body = {
				systemInstruction: { parts: [{ text: system }] },
				contents: messages.map(toGeminiContent),
				tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
				toolConfig: { functionCallingConfig: { mode: "AUTO" } },
			};
			const res = await fetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new Error(`Gemini API ${res.status}: ${sanitize(text, opts.apiKey)}`);
			}
			const data = (await res.json()) as {
				candidates?: { content?: GeminiContent; finishReason?: string }[];
				promptFeedback?: { blockReason?: string };
			};
			const candidate = data.candidates?.[0];
			if (!candidate?.content?.parts?.length) {
				const reason = data.promptFeedback?.blockReason ?? candidate?.finishReason ?? "no candidate / empty parts";
				throw new Error(`Gemini returned no content (${reason}).`);
			}
			return parseParts(candidate.content.parts);
		},
	};
}

// The Gemini DEVELOPER API (generativelanguage) uses only "user" and "model" roles —
// unlike Vertex AI, there is no "function" role here. Tool results ride on a "user" turn
// as functionResponse parts.
function toGeminiContent(m: Message): GeminiContent {
	const parts: GeminiPart[] = [];
	if (m.text) parts.push({ text: m.text });
	for (const tc of m.toolCalls ?? []) parts.push({ functionCall: { name: tc.name, args: tc.args } });
	for (const tr of m.toolResults ?? []) {
		parts.push({
			functionResponse: { name: tr.name, response: tr.isError ? { error: tr.output } : { result: tr.output } },
		});
	}
	return { role: m.role, parts };
}

function parseParts(parts: GeminiPart[]): ModelResponse {
	let text = "";
	const toolCalls: ToolCall[] = [];
	parts.forEach((p, i) => {
		if (p.text) text += p.text;
		if (p.functionCall?.name) {
			toolCalls.push({ id: `${p.functionCall.name}-${i}`, name: p.functionCall.name, args: p.functionCall.args ?? {} });
		}
	});
	return { text: text.trim(), toolCalls };
}

function sanitize(s: string, key: string): string {
	return key ? s.split(key).join("[REDACTED]") : s;
}
