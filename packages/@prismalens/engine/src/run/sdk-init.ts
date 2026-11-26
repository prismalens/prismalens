// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Claude Code's session `init` as What loads rows (#1180 §3.1). claude-agent-acp forwards it
 * through `_claude/sdkMessage` when `_meta.claudeCode.emitRawSDKMessages` asks for it;
 * fields per claude-agent-sdk 0.3.328 `SDKSystemMessage`.
 */
import type { LoadedItem } from "@prismalens/contracts/schemas";

/** The ext notification claude-agent-acp sends a raw SDK message on. */
export const CLAUDE_SDK_MESSAGE = "_claude/sdkMessage";

/** The `_meta` that asks claude-agent-acp for the session's init message. */
export const CLAUDE_INIT_META = {
	claudeCode: { emitRawSDKMessages: [{ type: "system", subtype: "init" }] },
} as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v);

/** The SDK message an `_claude/sdkMessage` notification carries, when it is the init. */
export function initOf(params: unknown): Record<string, unknown> | null {
	const m = isRecord(params)
		? isRecord(params.message)
			? params.message
			: params
		: null;
	return m && m.type === "system" && m.subtype === "init" ? m : null;
}

const SCOPES: Record<string, LoadedItem["scope"]> = {
	user: "global",
	project: "repo",
	local: "repo",
	plugin: "plugin",
	managed: "managed",
	enterprise: "managed",
	sdk: "prismalens",
	dynamic: "prismalens",
};

const STATES: Record<string, LoadedItem["state"]> = {
	connected: "loads",
	failed: "failed",
	"needs-auth": "failed",
	pending: "unknown",
	disabled: "off",
};

/** One row per MCP server, skill and plugin the init names; paths only where it gives one. */
export function initItems(init: Record<string, unknown>): LoadedItem[] {
	const base = { disk: true, reported: null } as const;
	const out: LoadedItem[] = [];
	for (const s of Array.isArray(init.mcp_servers) ? init.mcp_servers : []) {
		if (!isRecord(s) || typeof s.name !== "string" || !s.name) continue;
		out.push({
			...base,
			kind: "mcp",
			name: s.name.slice(0, 200),
			scope: SCOPES[String(s.source ?? "user")] ?? "global",
			path: null,
			state: STATES[String(s.status)] ?? "unknown",
		});
	}
	for (const s of Array.isArray(init.skills) ? init.skills : []) {
		const name = typeof s === "string" ? s : isRecord(s) ? s.name : null;
		if (typeof name === "string" && name)
			out.push({
				...base,
				kind: "skill",
				name: name.slice(0, 200),
				scope: "global",
				path: null,
				state: "loads",
			});
	}
	for (const p of Array.isArray(init.plugins) ? init.plugins : []) {
		if (!isRecord(p) || typeof p.name !== "string" || !p.name) continue;
		out.push({
			...base,
			kind: "plugin",
			name: p.name.slice(0, 200),
			scope: "plugin",
			path: typeof p.path === "string" ? p.path.slice(0, 1024) : null,
			state: "loads",
		});
	}
	return out.slice(0, 500);
}
