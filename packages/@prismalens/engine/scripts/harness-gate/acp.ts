// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
	type Client,
	ClientSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";
import type { Fixture } from "./fixture.js";
import {
	allowed,
	type GateEvent,
	type GateSession,
	withTimeout,
} from "./session.js";

export interface AcpLaunch {
	command: string;
	args: string[];
	env: Record<string, string>;
	/** Extra fields for `session/new`, such as a harness's `_meta`. */
	sessionExtra?: Record<string, unknown>;
}

const str = (v: unknown) => (v === undefined ? undefined : JSON.stringify(v));

/** One ACP client for every ACP harness: the transport under test is the protocol, not the harness. */
export async function openAcp(
	fx: Fixture,
	launch: AcpLaunch,
): Promise<GateSession> {
	const child = spawn(launch.command, launch.args, {
		cwd: fx.repo,
		env: launch.env,
		stdio: ["pipe", "pipe", "ignore"],
		detached: true,
	});
	const events: GateEvent[] = [];
	let turnText = "";
	const client: Client = {
		async requestPermission(p) {
			const request = `${p.toolCall.title ?? ""} ${JSON.stringify(p.toolCall.rawInput ?? {})}`;
			events.push({ t: Date.now(), kind: "permission", request });
			const kind = allowed(request, p.toolCall.kind ?? undefined)
				? "allow_once"
				: "reject_once";
			const option = p.options.find((o) => o.kind === kind) ?? p.options[0];
			return { outcome: { outcome: "selected", optionId: option.optionId } };
		},
		async sessionUpdate(n) {
			const u = n.update;
			const t = Date.now();
			if (
				u.sessionUpdate === "agent_message_chunk" &&
				u.content.type === "text"
			) {
				turnText += u.content.text;
				events.push({ t, kind: "text", output: u.content.text });
			} else if (u.sessionUpdate === "agent_thought_chunk")
				events.push({ t, kind: "delta" });
			else if (
				u.sessionUpdate === "tool_call" ||
				u.sessionUpdate === "tool_call_update"
			) {
				const meta = (u._meta ?? {}) as {
					claudeCode?: { parentToolUseId?: string };
				};
				events.push({
					t,
					kind: "tool",
					id: u.toolCallId,
					name: u.title ?? undefined,
					status: u.status ?? undefined,
					input: str(u.rawInput),
					output: str(u.rawOutput ?? u.content ?? undefined),
					parentId: meta.claudeCode?.parentToolUseId,
				});
			}
		},
	};
	const conn = new ClientSideConnection(
		() => client,
		ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
	);
	await conn.initialize({
		protocolVersion: PROTOCOL_VERSION,
		clientCapabilities: {},
	});
	const { sessionId } = await conn.newSession({
		cwd: fx.repo,
		mcpServers: [
			{
				name: "probe",
				command: fx.probe.command,
				args: fx.probe.args,
				env: Object.entries(fx.probe.env).map(([name, value]) => ({
					name,
					value,
				})),
			},
		],
		...launch.sessionExtra,
	});
	return {
		events,
		async prompt(text, timeoutMs) {
			turnText = "";
			try {
				const res = await withTimeout(
					conn.prompt({ sessionId, prompt: [{ type: "text", text }] }),
					timeoutMs,
					null,
				);
				return {
					settled: res !== null,
					ended: res?.stopReason === "end_turn",
					text: turnText,
				};
			} catch (e) {
				return {
					settled: true,
					ended: false,
					text: turnText,
					error: String(e),
				};
			}
		},
		async cancel() {
			await conn.cancel({ sessionId });
		},
		async close() {
			if (child.pid)
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {
					// already gone
				}
		},
	};
}
