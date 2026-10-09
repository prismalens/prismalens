// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * R7 (#804 OBJ-029): a real model will not fail its report on request, so
 * the admission run puts this proxy between the installed adapter and the
 * Anthropic-compatible endpoint. It turns braces in the model's text into
 * parentheses, so the report never parses; tool calls pass untouched.
 */
import { createServer, type Server } from "node:http";

/** The model's text with every JSON brace swapped out; nothing else changes. */
export function breakBraces(text: string): string {
	return text.replace(/\{/g, "(").replace(/\}/g, ")");
}

/** One SSE line from the Messages API, its text deltas broken. */
export function breakSseLine(line: string): string {
	if (!line.startsWith("data:")) return line;
	try {
		const event = JSON.parse(line.slice(5)) as {
			delta?: { type?: string; text?: string };
			content_block?: { type?: string; text?: string };
		};
		if (event.delta?.type === "text_delta" && event.delta.text)
			event.delta.text = breakBraces(event.delta.text);
		else if (event.content_block?.type === "text" && event.content_block.text)
			event.content_block.text = breakBraces(event.content_block.text);
		else return line;
		return `data: ${JSON.stringify(event)}`;
	} catch {
		return line;
	}
}

/** A non-streaming Messages API body, its text blocks broken. */
export function breakJsonBody(body: string): string {
	try {
		const message = JSON.parse(body) as {
			content?: { type?: string; text?: string }[];
		};
		if (!Array.isArray(message.content)) return body;
		for (const block of message.content)
			if (block.type === "text" && block.text)
				block.text = breakBraces(block.text);
		return JSON.stringify(message);
	} catch {
		return body;
	}
}

/** Starts the proxy on a free local port in front of `upstream`. */
export async function startReportBreakingProxy(
	upstream: string,
): Promise<{ url: string; close(): Promise<void> }> {
	const base = upstream.replace(/\/$/, "");
	const server: Server = createServer(async (req, res) => {
		try {
			const chunks: Buffer[] = [];
			for await (const c of req) chunks.push(c as Buffer);
			const headers = new Headers();
			for (const [k, v] of Object.entries(req.headers)) {
				if (
					v === undefined ||
					["host", "content-length", "accept-encoding"].includes(k)
				)
					continue;
				headers.set(k, Array.isArray(v) ? v.join(", ") : v);
			}
			headers.set("accept-encoding", "identity");
			const up = await fetch(`${base}${req.url ?? ""}`, {
				method: req.method,
				headers,
				...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
			});
			const out: Record<string, string> = {};
			up.headers.forEach((v, k) => {
				if (
					!["content-length", "content-encoding", "transfer-encoding"].includes(
						k,
					)
				)
					out[k] = v;
			});
			res.writeHead(up.status, out);
			const type = up.headers.get("content-type") ?? "";
			if (type.includes("text/event-stream") && up.body) {
				const decoder = new TextDecoder();
				let carry = "";
				for await (const part of up.body) {
					carry += decoder.decode(part as Uint8Array, { stream: true });
					const lines = carry.split("\n");
					carry = lines.pop() ?? "";
					for (const line of lines) res.write(`${breakSseLine(line)}\n`);
				}
				if (carry) res.write(breakSseLine(carry));
				res.end();
				return;
			}
			const text = await up.text();
			res.end(type.includes("json") ? breakJsonBody(text) : text);
		} catch (e) {
			res.writeHead(502).end(String(e));
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}
