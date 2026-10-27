// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Server } from "@modelcontextprotocol/server";
import type { SourceRegistry } from "@prismalens/integrations";
import { z } from "zod";
import { scrubSecrets } from "../integrations/source-request.js";

/** Characters of JSON one tool result returns. */
export const RESULT_CHARS = 32_000;

type JsonSchemaObject = { type: "object"; [k: string]: unknown };

export type McpToolResult = {
	content: { type: "text"; text: string }[];
	isError?: boolean;
};

/** A tool's value as MCP text: exact-value scrubbed, then capped. */
export function mcpText(
	value: unknown,
	secrets: readonly string[],
	isError = false,
): McpToolResult {
	let text = scrubSecrets(JSON.stringify(value, null, 1), [...secrets]);
	if (text.length > RESULT_CHARS)
		text = `${text.slice(0, RESULT_CHARS)}\n…[truncated at ${RESULT_CHARS} characters; narrow the query]`;
	return {
		content: [{ type: "text", text }],
		...(isError ? { isError: true } : {}),
	};
}

/** The run's MCP surface (#848): PrismaLens's own read-only harness tools, nothing else. */
export function gatewayMcpServer(
	registry: SourceRegistry,
	runId: string,
	onCall?: (name: string) => void,
): Server {
	const server = new Server(
		{ name: "prismalens", version: "0.3.0" },
		{ capabilities: { tools: {} } },
	);
	server.setRequestHandler("tools/list", () => ({
		tools: registry.list().map((t) => ({
			name: t.name,
			title: t.title,
			description: t.description,
			inputSchema: z.toJSONSchema(t.input, {
				io: "input",
			}) as JsonSchemaObject,
			annotations: { readOnlyHint: true, openWorldHint: t.openWorld },
		})),
	}));
	server.setRequestHandler("tools/call", async (req, ctx) => {
		const { name, arguments: args } = req.params;
		if (registry.list().some((t) => t.name === name)) onCall?.(name);
		const r = await registry.call(name, args ?? {}, {
			runId,
			signal: ctx.mcpReq.signal,
		});
		return mcpText(r.value, r.secrets ?? [], r.isError);
	});
	return server;
}
