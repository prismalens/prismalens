// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	humanizeTool,
	isPlServerName,
	plTool,
	plToolName,
} from "@prismalens/contracts";

/**
 * What an ask names its tool by: never a raw id such as
 * `mcp__prismalens__pl_browser_run_script` (#1105). A PrismaLens tool reads its
 * registry label (#1125); another server's tool reads its words and its server.
 */
const RAW_ID = /^[A-Za-z0-9]+([_.-][A-Za-z0-9]+)+$/;

/** An ask or step title in words; a title that is already words passes through. */
export function toolTitle(title: string): string {
	const t = title.trim().replace(/^`([\s\S]*)`$/, "$1");
	const mcp =
		/^mcp__(.+?)__(.+)$/.exec(t) ?? /^([\w.-]+) \(([\w.-]+)\)$/.exec(t);
	let server: string | null = null;
	let tool = t;
	if (mcp?.[0].startsWith("mcp__")) {
		server = mcp[1] ?? null;
		tool = mcp[2] ?? t;
	} else if (mcp) {
		tool = mcp[1] ?? t;
		server = mcp[2] ?? null;
	} else if (!RAW_ID.test(t)) return title;
	const name = plToolName(tool);
	if (!server || isPlServerName(server))
		return plTool(name)?.label.ask ?? humanizeTool(name);
	return `${humanizeTool(tool)} · ${server.replace(/^plugin_/, "")}`;
}
