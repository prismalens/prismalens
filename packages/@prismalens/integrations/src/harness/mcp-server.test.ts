// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { harnessMcpServer, harnessPromptLine } from "./mcp-server.js";
import type { HarnessCall } from "./registry.js";
import { runView } from "./search.js";
import { annotationsFor, defineHarnessTool } from "./tool.js";

const makeFakeTools = (recorded: unknown[] = []) => {
	const incidentGet = defineHarnessTool({
		name: "incident_get",
		title: "Get current incident details",
		description: "Read details of the incident currently being investigated.",
		group: "core",
		effect: "read",
		input: z.object({ number: z.number().optional() }),
		run: async () => ({
			value: { number: 42, title: "DB down" },
		}),
	});

	const investigationsSearch = defineHarnessTool({
		name: "investigations_search",
		title: "Search past investigations",
		description: "Find past investigations matching query keywords.",
		group: "knowledge",
		effect: "read",
		input: z.object({ query: z.string() }),
		run: async () => ({
			value: [],
		}),
	});

	const runbooksList = defineHarnessTool({
		name: "runbooks_list",
		title: "List runbooks",
		description: "List runbooks matching service.",
		group: "knowledge",
		effect: "read",
		input: z.object({ service: z.string().optional() }),
		run: async () => ({
			value: [],
		}),
	});

	const runbooksRead = defineHarnessTool({
		name: "runbooks_read",
		title: "Read runbook",
		description: "Read the markdown content of a runbook.",
		group: "core",
		effect: "read",
		input: z.object({ path: z.string() }),
		run: async () => ({
			value: { ok: false, error: "Not found" },
		}),
	});

	const evidenceRecord = defineHarnessTool({
		name: "evidence_record",
		title: "Record evidence",
		description: "Record a verified piece of evidence.",
		group: "record",
		effect: "record",
		input: z.object({
			id: z.string(),
			observation: z.string().optional(),
			source: z.string().optional(),
		}),
		run: async (input) => {
			recorded.push({ type: "evidence", ...input });
			return { value: { recorded: true } };
		},
	});

	const hypothesisRecord = defineHarnessTool({
		name: "hypothesis_record",
		title: "Record hypothesis",
		description: "Record a hypothesis being tested.",
		group: "record",
		effect: "record",
		input: z.object({
			id: z.string(),
			claim: z.string().optional(),
		}),
		run: async (input) => {
			recorded.push({ type: "hypothesis", ...input });
			return { value: { recorded: true } };
		},
	});

	return [
		incidentGet,
		investigationsSearch,
		runbooksList,
		runbooksRead,
		evidenceRecord,
		hypothesisRecord,
	];
};

describe("harnessMcpServer", () => {
	it("returns direct tools with derived annotations via tools/list", async () => {
		const tools = makeFakeTools();
		const view = runView(tools, { search: true });

		const server = harnessMcpServer({
			runId: "run-mcp",
			view,
			version: "1.0.0",
		});

		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();

		const client = new Client({ name: "test-client", version: "1.0.0" });
		await server.connect(serverTransport);
		await client.connect(clientTransport);

		try {
			const listResult = await client.listTools();
			const serverToolNames = listResult.tools.map((t) => t.name).sort();
			const viewToolNames = view.direct.map((t) => t.name).sort();
			expect(serverToolNames).toEqual(viewToolNames);

			for (const directTool of view.direct) {
				const clientTool = listResult.tools.find(
					(t) => t.name === directTool.name,
				);
				expect(clientTool).toBeDefined();
				expect(clientTool?.annotations).toEqual(
					annotationsFor(directTool.effect),
				);
			}
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("rejects calling a tool not in the view with a protocol error", async () => {
		const tools = makeFakeTools();
		const view = runView(tools, { search: true });

		const server = harnessMcpServer({
			runId: "run-mcp",
			view,
			version: "1.0.0",
		});

		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();

		const client = new Client({ name: "test-client", version: "1.0.0" });
		await server.connect(serverTransport);
		await client.connect(clientTransport);

		try {
			// Calling deferred tool directly or unknown tool rejected with protocol error
			await expect(
				client.callTool({
					name: "investigations_search",
					arguments: { query: "test" },
				}),
			).rejects.toThrow();
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("returns text content and onCall receives HarnessCall with real tool name", async () => {
		const tools = makeFakeTools();
		const view = runView(tools, { search: true });
		const recordedCalls: HarnessCall[] = [];

		const server = harnessMcpServer({
			runId: "run-mcp",
			view,
			version: "1.0.0",
			onCall: (call) => recordedCalls.push(call),
		});

		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();

		const client = new Client({ name: "test-client", version: "1.0.0" });
		await server.connect(serverTransport);
		await client.connect(clientTransport);

		try {
			// Direct call to evidence_record
			const res = await client.callTool({
				name: "evidence_record",
				arguments: {
					id: "e1",
					observation: "Observed latency spike",
					source: "grafana",
				},
			});

			expect(res.content).toBeDefined();
			expect(res.content[0].type).toBe("text");
			expect(recordedCalls.length).toBe(1);
			expect(recordedCalls[0].name).toBe("evidence_record");

			// Delegated call through tools_call
			await client.callTool({
				name: "tools_call",
				arguments: {
					name: "investigations_search",
					arguments: { query: "latency" },
				},
			});

			expect(recordedCalls.length).toBe(2);
			expect(recordedCalls[1].name).toBe("investigations_search");
		} finally {
			await client.close();
			await server.close();
		}
	});
});

describe("harnessPromptLine", () => {
	it("formats prompt line correctly with deferred tools and record tools", () => {
		const tools = makeFakeTools();
		const view = runView(tools, { search: true });
		const line = harnessPromptLine(view, "test-server");

		expect(line).toContain("MCP server `test-server`");
		for (const t of view.direct) {
			expect(line).toContain(`\`${t.name}\``);
		}
		expect(line).toContain("Find more PrismaLens tools with `tools_search`.");
		expect(line).toContain(
			"record each piece of evidence with `evidence_record`",
		);
		expect(line).toContain(
			"For metrics, logs and other live data, use the tools your own setup gives you.",
		);
	});

	it("omits tools_search when no tools are deferred, and omits evidence_record when no record tools", () => {
		const tools = makeFakeTools().filter(
			(t) => t.group !== "knowledge" && t.group !== "record",
		);
		const view = runView(tools, { search: false });
		const line = harnessPromptLine(view, "test-server");

		expect(line).not.toContain("tools_search");
		expect(line).not.toContain("evidence_record");
		expect(line).toContain(
			"For metrics, logs and other live data, use the tools your own setup gives you.",
		);
	});
});
