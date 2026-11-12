// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isPlServerName, plToolName } from "@prismalens/contracts";

/**
 * What an ask names its tool by: never a raw id such as
 * `mcp__prismalens__pl_browser_run_script` (#1105). A PrismaLens tool reads its
 * label; another server's tool reads its words and its server.
 */
const PL_ASK_LABEL: Record<string, string> = {
	pl_thread_start: "Start a thread",
	pl_thread_send: "Send a message to a thread",
	pl_thread_wait: "Wait for a thread",
	pl_thread_cancel: "Stop a thread",
	pl_thread_read: "Read a thread",
	pl_thread_title: "Name this thread",
	pl_pr_watch: "Watch a change request",
	pl_pr_unwatch: "Stop watching a change request",
	pl_pr_link: "Link a change request",
	pl_ask_user: "Ask you",
	pl_secret_request: "Ask for a secret",
	pl_wakeup_schedule: "Schedule a wake-up",
	pl_artifact_publish: "Publish a page",
	pl_runbooks_read: "Read the runbooks",
	pl_service_get: "Read a service",
	pl_evidence_record: "Record evidence",
	pl_hypothesis_record: "Record a likely cause",
	pl_attachment_read: "Read an attachment",
	pl_cron_create: "Create a schedule",
	pl_browser_navigate: "Open a page",
	pl_browser_snapshot: "Read the page",
	pl_browser_click: "Click on the page",
	pl_browser_type: "Type on the page",
	pl_browser_select: "Choose on the page",
	pl_browser_press: "Press a key on the page",
	pl_browser_scroll: "Scroll the page",
	pl_browser_tabs: "Switch browser tabs",
	pl_browser_run_script: "Run a script on the page",
};

/** `browser_run_script` → "Browser run script". */
export function humanizeTool(id: string): string {
	const words = id
		.replace(/^pl_/, "")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_\-.]+/g, " ")
		.trim()
		.toLowerCase();
	return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

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
		return PL_ASK_LABEL[name] ?? humanizeTool(name);
	return `${humanizeTool(tool)} · ${server.replace(/^plugin_/, "")}`;
}
