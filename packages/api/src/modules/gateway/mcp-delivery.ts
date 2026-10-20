// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type CallToolResult, Server } from "@modelcontextprotocol/server";
import type {
	ProxyCallResult,
	ProxyPort,
	ProxySnapshot,
	SourceRegistry,
} from "@prismalens/integrations";
import { z } from "zod";
import { LIMITS, mcpText } from "./source-tools.js";

export const SOURCES_LIST = "sources_list";

export interface DeliveryDeps {
	registry: SourceRegistry;
	proxy: ProxyPort;
	sourcesList(runId: string): Promise<unknown>;
	/** The run's vendor tool list, fixed at lease. */
	snapshot(runId: string): ProxySnapshot;
}

type JsonSchemaObject = { type: "object"; [k: string]: unknown };

const SOURCES_LIST_TOOL = {
	name: SOURCES_LIST,
	title: "PrismaLens data sources",
	description:
		"Every data category (metrics, logs, scm, deploys, knowledge, mcp) with its status: connected, not-configured, unreachable or removed, and which tools read it. Call first to know what this run can reach.",
	inputSchema: { type: "object", properties: {} } as JsonSchemaObject,
	annotations: { readOnlyHint: true, openWorldHint: false },
};

/**
 * One budget for the whole result: text blocks in order, then structured content,
 * which is dropped whole when it does not fit. Images and other blocks pass unchanged.
 */
function capText(result: ProxyCallResult): ProxyCallResult {
	let left = LIMITS.resultChars;
	let cut = false;
	const content = result.content.map((c) => {
		const block = c as { type?: string; text?: string };
		if (block.type !== "text" || typeof block.text !== "string") return c;
		const text = block.text.slice(0, Math.max(0, left));
		left -= block.text.length;
		if (text.length === block.text.length) return c;
		cut = true;
		return { ...block, text };
	});
	const structured =
		result.structuredContent === undefined
			? 0
			: JSON.stringify(result.structuredContent).length;
	const keep = structured <= Math.max(0, left);
	if (!cut && keep) return result;
	const { structuredContent: _, ...rest } = result;
	return {
		...rest,
		...(keep ? { structuredContent: result.structuredContent } : {}),
		content: [
			...content,
			{
				type: "text",
				text: `…[truncated at ${LIMITS.resultChars} characters${keep ? "" : "; structured content dropped"}]`,
			},
		],
	};
}

/**
 * The run's MCP surface (#848): the registry's read-only tools, `sources_list`, and the
 * vendor tools the run's snapshot offers, whose schemas pass through unconverted.
 */
export function gatewayMcpServer(deps: DeliveryDeps, runId: string): Server {
	const server = new Server(
		{ name: "prismalens", version: "0.2.0" },
		{ capabilities: { tools: {} } },
	);
	server.setRequestHandler("tools/list", () => ({
		tools: [
			SOURCES_LIST_TOOL,
			...deps.registry.list().map((t) => ({
				name: t.name,
				title: t.title,
				description: t.description,
				inputSchema: z.toJSONSchema(t.input, {
					io: "input",
				}) as JsonSchemaObject,
				annotations: { readOnlyHint: true, openWorldHint: t.openWorld },
			})),
			...deps.snapshot(runId).connections.flatMap((c) =>
				c.tools.map((t) => ({
					name: t.offered,
					description: `[${c.name}: ${c.description}] ${t.description}`,
					inputSchema: t.inputSchema as JsonSchemaObject,
					// A vendor's readOnlyHint is never forwarded, so it cannot skip the agent's own ask.
					annotations: { readOnlyHint: false, openWorldHint: true },
				})),
			),
		],
	}));
	server.setRequestHandler("tools/call", async (req, ctx) => {
		const { name, arguments: args } = req.params;
		const signal = ctx.mcpReq.signal;
		if (name === SOURCES_LIST)
			return mcpText(await deps.sourcesList(runId), []);
		if (name.includes("__"))
			// Forwarded as the server sent it; only the text is capped (#848).
			return capText(
				await deps.proxy.call(runId, name, args ?? {}, signal),
			) as CallToolResult;
		const r = await deps.registry.call(name, args ?? {}, { runId, signal });
		return mcpText(r.value, r.secrets ?? [], r.isError);
	});
	return server;
}
