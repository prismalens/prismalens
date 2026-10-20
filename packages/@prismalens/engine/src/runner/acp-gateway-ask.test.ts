// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { EventEmitter } from "node:events";
import { PassThrough, Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { HarnessChild } from "../launch/types.js";
import { levelPolicy, type PermissionPolicy } from "../run/permission.js";
import { AcpSession } from "./acp-client.js";

const OPTIONS = [
	{ optionId: "allow", name: "Allow", kind: "allow_once" },
	{ optionId: "reject", name: "Reject", kind: "reject_once" },
];

/**
 * Replays codex-acp's shapes (1.13.1, 2.2.2): during the turn it announces the call as
 * `tool_call` with title `mcp.prismalens.<tool>`, then asks with the id alone.
 */
function codex(announce: string | null) {
	const answers: unknown[] = [];
	const stdout = new PassThrough();
	const out = (m: unknown) => stdout.write(`${JSON.stringify(m)}\n`);
	let promptId: number | null = null;
	const child = new EventEmitter() as EventEmitter & HarnessChild;
	child.stdout = stdout;
	child.stderr = Readable.from([]);
	child.killed = false;
	child.kill = () => true;
	child.stdin = new Writable({
		write(chunk, _enc, cb) {
			for (const line of String(chunk).split("\n").filter(Boolean)) {
				const msg = JSON.parse(line);
				if (msg.method === undefined && msg.id === 900) {
					answers.push(msg.result);
					out({ jsonrpc: "2.0", id: promptId, result: { stopReason: "end_turn" } });
					continue;
				}
				if (msg.method === "initialize")
					out({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: {} } });
				else if (msg.method === "session/new")
					out({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s1" } });
				else if (msg.method === "session/prompt") {
					promptId = msg.id;
					if (announce)
						out({
							jsonrpc: "2.0",
							method: "session/update",
							params: {
								sessionId: "s1",
								update: {
									sessionUpdate: "tool_call",
									toolCallId: "call_1",
									title: announce,
									kind: "execute",
									status: "pending",
								},
							},
						});
					out({
						jsonrpc: "2.0",
						id: 900,
						method: "session/request_permission",
						params: {
							sessionId: "s1",
							options: OPTIONS,
							toolCall: { toolCallId: "call_1", kind: "execute", status: "pending" },
						},
					});
				} else if (msg.id !== undefined) out({ jsonrpc: "2.0", id: msg.id, result: {} });
			}
			cb();
		},
	});
	return { child, answers };
}

async function ask(announce: string | null, policy: PermissionPolicy) {
	const { child, answers } = codex(announce);
	const session = new AcpSession({
		command: "codex-acp",
		args: [],
		cwd: "/tmp",
		launcher: { spawn: () => child, destroy: async () => {} },
		permission: policy,
		initTimeoutMs: 1_000,
	});
	await session.open();
	for await (const _ of session.prompt("go")) {
		// drain the turn
	}
	await session.close();
	return answers[0];
}

const unattended = levelPolicy(
	"full-access",
	{ policy: async () => ({ allow: false, why: "card", outcome: "denied" }) },
	{
		unattended: true,
		gateway: { confirmed: () => true, tools: ["sources_list"] },
	},
);
const selected = (optionId: string) => ({ outcome: { outcome: "selected", optionId } });

describe("an ID-only ask matched to the agent's own tool_call (#848, OBJ-011)", () => {
	it("allows a PrismaLens read announced earlier under the same id, unattended", async () => {
		expect(await ask("mcp.prismalens.sources_list", unattended)).toEqual(selected("allow"));
	});

	it("denies the same ask with no earlier announcement", async () => {
		expect(await ask(null, unattended)).toEqual(selected("reject"));
	});

	it("denies a proxied tool announced on our server", async () => {
		expect(await ask("mcp.prismalens.n8n_prod__list_workflows", unattended)).toEqual(
			selected("reject"),
		);
	});
});
