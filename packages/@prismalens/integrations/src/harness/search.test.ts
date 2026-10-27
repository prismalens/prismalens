// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { executeTool } from "./registry.js";
import {
	TOOLS_CALL,
	TOOLS_SEARCH,
	resolveCall,
	runView,
} from "./search.js";
import { defineHarnessTool } from "./tool.js";

const makeFakeTools = (recorded: unknown[] = []) => {
	const incidentGet = defineHarnessTool({
		name: "incident_get",
		title: "Get current incident details",
		description: "Read details of the incident currently being investigated.",
		group: "core",
		effect: "read",
		input: z.object({ number: z.number().optional() }),
		run: async () => ({
			value: {
				number: 42,
				title: "DB down",
				status: "open",
				severity: "sev1",
				service: "db",
				triggeredAt: "2026-01-01T00:00:00Z",
				description: "DB incident",
				alerts: [],
				changes: [],
			},
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
			value: [
				{
					investigationId: "inv-1",
					incident: { number: 42, title: "DB down", service: "db" },
					completedAt: "2026-01-01T00:00:00Z",
					agentFinding: {
						summary: "OOM",
						rootCause: "Leak",
						category: "memory",
					},
					operatorRecordedCause: null,
				},
			],
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
			value: [
				{
					title: "Restart DB",
					path: "runbooks/db.md",
					service: "db",
					matchedBy: "service",
					origin: "repo",
				},
			],
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
			value: {
				ok: true,
				path: "runbooks/db.md",
				markdown: "# Restart DB",
			},
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

describe("runView", () => {
	it("returns all tools in direct and empty deferred when search is false", () => {
		const tools = makeFakeTools();
		const view = runView(tools, { search: false });
		expect(view.direct).toEqual(tools);
		expect(view.deferred).toEqual([]);
	});

	it("splits tools into direct and deferred when search is true", () => {
		const tools = makeFakeTools();
		const view = runView(tools, { search: true });
		const deferredNames = view.deferred.map((t) => t.name).sort();
		expect(deferredNames).toEqual(["investigations_search", "runbooks_list"]);

		const directNames = view.direct.map((t) => t.name);
		expect(directNames).toContain("incident_get");
		expect(directNames).toContain("runbooks_read");
		expect(directNames).toContain("evidence_record");
		expect(directNames).toContain("hypothesis_record");
		expect(directNames).toContain(TOOLS_SEARCH);
		expect(directNames).toContain(TOOLS_CALL);

		for (const t of view.deferred) {
			expect(t.effect).toBe("read");
		}
	});
});

describe("tools_search", () => {
	it("returns investigations_search first with inputSchema when query matches past investigations", async () => {
		const tools = makeFakeTools();
		const view = runView(tools, { search: true });
		const searchTool = view.direct.find((t) => t.name === TOOLS_SEARCH);
		expect(searchTool).toBeDefined();

		const call = await executeTool(
			searchTool!,
			{ query: "past investigations" },
			{
				runId: "run-test",
				signal: new AbortController().signal,
			},
		);

		expect(call.isError).toBe(false);
		const parsed = JSON.parse(call.output);
		expect(parsed.tools).toBeDefined();
		expect(parsed.tools.length).toBeGreaterThan(0);
		expect(parsed.tools[0].name).toBe("investigations_search");
		expect(parsed.tools[0].inputSchema).toBeDefined();
	});

	it("returns tools: [] and available names when matching nothing", async () => {
		const tools = makeFakeTools();
		const view = runView(tools, { search: true });
		const searchTool = view.direct.find((t) => t.name === TOOLS_SEARCH);
		expect(searchTool).toBeDefined();

		const call = await executeTool(
			searchTool!,
			{ query: "zzzzzzzz nonexistent 99999" },
			{
				runId: "run-test",
				signal: new AbortController().signal,
			},
		);

		expect(call.isError).toBe(false);
		const parsed = JSON.parse(call.output);
		expect(parsed.tools).toEqual([]);
		expect(parsed.available).toEqual(
			expect.arrayContaining(["investigations_search", "runbooks_list"]),
		);
	});
});

describe("resolveCall", () => {
	it("refuses a deferred tool called directly by name (returns undefined)", () => {
		const tools = makeFakeTools();
		const view = runView(tools, { search: true });
		const resolved = resolveCall(view, "investigations_search", { query: "x" });
		expect(resolved).toBeUndefined();
	});

	it("resolves tools_call to target tool with arguments", () => {
		const tools = makeFakeTools();
		const view = runView(tools, { search: true });
		const resolved = resolveCall(view, TOOLS_CALL, {
			name: "investigations_search",
			arguments: { query: "x" },
		});
		expect(resolved).toBeDefined();
		expect(resolved?.tool.name).toBe("investigations_search");
		expect(resolved?.args).toEqual({ query: "x" });
	});

	it("does not resolve tools_call naming evidence_record (falls back to tools_call)", async () => {
		const tools = makeFakeTools();
		const view = runView(tools, { search: true });
		const resolved = resolveCall(view, TOOLS_CALL, {
			name: "evidence_record",
			arguments: { id: "e1" },
		});
		expect(resolved).toBeDefined();
		expect(resolved?.tool.name).toBe(TOOLS_CALL);

		const call = await executeTool(resolved!.tool, resolved!.args, {
			runId: "run-test",
			signal: new AbortController().signal,
		});
		expect(call.isError).toBe(true);
		const parsed = JSON.parse(call.output);
		expect(parsed.error).toBe("not_found");
	});

	it("returns undefined for an unknown tool name", () => {
		const tools = makeFakeTools();
		const view = runView(tools, { search: true });
		const resolved = resolveCall(view, "non_existent_tool", {});
		expect(resolved).toBeUndefined();
	});
});
