// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ProtocolError,
	ProtocolErrorCode,
	Server,
} from "@modelcontextprotocol/server";
import { executeTool, type HarnessCall, type RunView } from "./registry.js";
import { resolveCall } from "./search.js";
import { annotationsFor, inputSchemaOf } from "./tool.js";

export interface RunServerOptions {
	runId: string;
	view: RunView;
	/** PrismaLens's package version. */
	version: string;
	secrets?: readonly string[];
	/** Every call the run executed, as it will be recorded. */
	onCall?: (call: HarnessCall) => void;
}

/** One run's MCP surface (#848): its view of PrismaLens's harness tools, nothing else. */
export function harnessMcpServer(o: RunServerOptions): Server {
	const server = new Server(
		{ name: "prismalens", version: o.version },
		{ capabilities: { tools: {} } },
	);
	server.setRequestHandler("tools/list", () => ({
		tools: o.view.direct.map((t) => ({
			name: t.name,
			title: t.title,
			description: t.description,
			inputSchema: inputSchemaOf(t),
			annotations: annotationsFor(t.effect),
		})),
	}));
	server.setRequestHandler("tools/call", async (req, ctx) => {
		const { name, arguments: args } = req.params;
		const target = resolveCall(o.view, name, args);
		if (!target)
			throw new ProtocolError(
				ProtocolErrorCode.InvalidParams,
				`Unknown tool: ${name}`,
			);
		const call = await executeTool(target.tool, target.args, {
			runId: o.runId,
			signal: ctx.mcpReq.signal,
			...(o.secrets ? { secrets: o.secrets } : {}),
		});
		o.onCall?.(call);
		return {
			content: [{ type: "text" as const, text: call.output }],
			...(call.isError ? { isError: true } : {}),
		};
	});
	return server;
}

/** The prompt's tools paragraph (#848): the run's listed tools, and that data access is the agent's own. */
export function harnessPromptLine(view: RunView, serverName: string): string {
	const names = view.direct.map((t) => `\`${t.name}\``).join(", ");
	const records = view.direct.some((t) => t.name === "evidence_record");
	return [
		`PrismaLens tools (MCP server \`${serverName}\`): ${names}.${view.deferred.length ? " Find more PrismaLens tools with `tools_search`." : ""}`,
		...(records
			? [
					"As you work, record each piece of evidence with `evidence_record`, quoting the output exactly, and each hypothesis with `hypothesis_record`; the operator watches them form. Your final report is still required: give each hypothesis you recorded the same `id` there.",
				]
			: []),
		"For metrics, logs and other live data, use the tools your own setup gives you.",
	].join("\n");
}
