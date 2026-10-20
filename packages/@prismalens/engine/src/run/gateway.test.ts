// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { EventEmitter } from "node:events";
import { PassThrough, Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { HarnessChild } from "../launch/types.js";
import { AcpSession } from "../runner/acp-client.js";
import { type GatewayEntry, gatewayOffer } from "./gateway.js";

function entry(confirmed = false): GatewayEntry {
	return {
		url: "http://127.0.0.1:3001/api/mcp/runs/r1",
		token: "t0k",
		promptLine: "",
		tools: ["sources_list"],
		confirmed: () => confirmed,
		waitConfirmed: async () => confirmed,
	};
}

/** An agent that advertises `mcpCapabilities` at `initialize` and records what `session/new` got. */
function agent(mcpCapabilities: Record<string, boolean> | undefined) {
	const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
	const stdout = new PassThrough();
	const child = new EventEmitter() as EventEmitter & HarnessChild;
	child.stdout = stdout;
	child.stderr = Readable.from([]);
	child.killed = false;
	child.kill = () => true;
	child.stdin = new Writable({
		write(chunk, _enc, cb) {
			for (const line of String(chunk).split("\n").filter(Boolean)) {
				const msg = JSON.parse(line);
				if (msg.method === undefined) continue;
				sent.push(msg);
				const result =
					msg.method === "initialize"
						? {
								protocolVersion: 1,
								agentCapabilities: mcpCapabilities ? { mcpCapabilities } : {},
							}
						: msg.method === "session/new"
							? { sessionId: "s1" }
							: {};
				stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n`);
			}
			cb();
		},
	});
	return { child, sent };
}

async function openWith(
	mcpCapabilities: Record<string, boolean> | undefined,
	gateway = entry(),
	delivery?: "mcp-config-file",
) {
	const { child, sent } = agent(mcpCapabilities);
	const offer = gatewayOffer(gateway, delivery);
	const session = new AcpSession({
		command: "harness",
		args: [],
		cwd: "/tmp",
		launcher: { spawn: () => child, destroy: async () => {} },
		permission: { mode: "readOnly" } as never,
		initTimeoutMs: 250,
		mcpServers: offer.pick,
	});
	await session.open();
	await session.close();
	const params = sent.find((m) => m.method === "session/new")?.params;
	return { mcpServers: params?.mcpServers, taken: offer.taken() };
}

describe("the gateway in session/new mcpServers (#848)", () => {
	it("Given the agent advertises HTTP MCP, Then the gateway goes with the run's bearer", async () => {
		const { mcpServers, taken } = await openWith({ http: true, sse: true });
		expect(mcpServers).toEqual([
			{
				type: "http",
				name: "prismalens",
				url: "http://127.0.0.1:3001/api/mcp/runs/r1",
				headers: [{ name: "Authorization", value: "Bearer t0k" }],
			},
		]);
		// Offered is not taken: only a request with the run's token confirms it (OBJ-011).
		expect(taken).toBe(false);
		expect((await openWith({ http: true }, entry(true))).taken).toBe(true);
	});

	it("Given a run-file delivery, Then mcpServers stays empty and taken still means confirmed", async () => {
		const { mcpServers, taken } = await openWith({ http: true }, entry(true), "mcp-config-file");
		expect(mcpServers).toEqual([]);
		expect(taken).toBe(true);
	});

	for (const caps of [undefined, { http: false, sse: true }]) {
		it(`Given mcpCapabilities ${JSON.stringify(caps)}, Then mcpServers is empty and the run knows`, async () => {
			const { mcpServers, taken } = await openWith(caps);
			expect(mcpServers).toEqual([]);
			expect(taken).toBe(false);
		});
	}

	it("Given no gateway, Then mcpServers stays empty", async () => {
		const { child, sent } = agent({ http: true });
		const session = new AcpSession({
			command: "harness",
			args: [],
			cwd: "/tmp",
			launcher: { spawn: () => child, destroy: async () => {} },
			permission: { mode: "readOnly" } as never,
			initTimeoutMs: 250,
		});
		await session.open();
		await session.close();
		expect(
			sent.find((m) => m.method === "session/new")?.params?.mcpServers,
		).toEqual([]);
	});
});
