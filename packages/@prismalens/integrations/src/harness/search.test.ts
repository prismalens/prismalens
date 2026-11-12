// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { executeTool, resultValue } from "./registry.js";
import {
	autoAllowed,
	TOOLS_CALL,
	TOOLS_SEARCH,
	resolveCall,
	runView,
} from "./search.js";
import { defineHarnessTool, EVERY_SUBJECT } from "./tool.js";

const makeFakeTools = (recorded: unknown[] = []) => {
	const incidentGet = defineHarnessTool({
		name: "pl_incident_get",
		title: "Get current incident details",
		description: "Read details of the incident currently being investigated.",
		group: "core",
		serves: { subjects: EVERY_SUBJECT },
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
		name: "pl_investigations_search",
		title: "Search past investigations",
		description: "Find past investigations matching query keywords.",
		group: "knowledge",
		serves: { subjects: EVERY_SUBJECT },
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
		name: "pl_runbooks_list",
		title: "List runbooks",
		description: "List runbooks matching service.",
		group: "knowledge",
		serves: { subjects: EVERY_SUBJECT },
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
		name: "pl_runbooks_read",
		title: "Read runbook",
		description: "Read the markdown content of a runbook.",
		group: "core",
		serves: { subjects: EVERY_SUBJECT },
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
		name: "pl_evidence_record",
		title: "Record evidence",
		description: "Record a verified piece of evidence.",
		group: "record",
		serves: { subjects: EVERY_SUBJECT },
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
		name: "pl_hypothesis_record",
		title: "Record hypothesis",
		description: "Record a hypothesis being tested.",
		group: "record",
		serves: { subjects: EVERY_SUBJECT },
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
		expect(deferredNames).toEqual(["pl_investigations_search", "pl_runbooks_list"]);

		const directNames = view.direct.map((t) => t.name);
		expect(directNames).toContain("pl_incident_get");
		expect(directNames).toContain("pl_runbooks_read");
		expect(directNames).toContain("pl_evidence_record");
		expect(directNames).toContain("pl_hypothesis_record");
		expect(directNames).toContain(TOOLS_SEARCH);
		expect(directNames).toContain(TOOLS_CALL);

		for (const t of view.deferred) {
			expect(t.effect).toBe("read");
		}
	});
});

describe("pl_tools_search", () => {
	it("returns pl_investigations_search first with inputSchema when query matches past investigations", async () => {
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
		const parsed = resultValue(call.output);
		expect(parsed.tools).toBeDefined();
		expect(parsed.tools.length).toBeGreaterThan(0);
		expect(parsed.tools[0].name).toBe("pl_investigations_search");
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
		const parsed = resultValue(call.output);
		expect(parsed.tools).toEqual([]);
		expect(parsed.available).toEqual(
			expect.arrayContaining(["pl_investigations_search", "pl_runbooks_list"]),
		);
	});
});

describe("resolveCall", () => {
	it("refuses a deferred tool called directly by name (returns undefined)", () => {
		const tools = makeFakeTools();
		const view = runView(tools, { search: true });
		const resolved = resolveCall(view, "pl_investigations_search", { query: "x" });
		expect(resolved).toBeUndefined();
	});

	it("resolves pl_tools_call to target tool with arguments", () => {
		const tools = makeFakeTools();
		const view = runView(tools, { search: true });
		const resolved = resolveCall(view, TOOLS_CALL, {
			name: "pl_investigations_search",
			arguments: { query: "x" },
		});
		expect(resolved).toBeDefined();
		expect(resolved?.tool.name).toBe("pl_investigations_search");
		expect(resolved?.args).toEqual({ query: "x" });
	});

	it("does not resolve pl_tools_call naming pl_evidence_record (falls back to pl_tools_call)", async () => {
		const tools = makeFakeTools();
		const view = runView(tools, { search: true });
		const resolved = resolveCall(view, TOOLS_CALL, {
			name: "pl_evidence_record",
			arguments: { id: "e1" },
		});
		expect(resolved).toBeDefined();
		expect(resolved?.tool.name).toBe(TOOLS_CALL);

		const call = await executeTool(resolved!.tool, resolved!.args, {
			runId: "run-test",
			signal: new AbortController().signal,
		});
		expect(call.isError).toBe(true);
		const parsed = resultValue(call.output);
		expect(parsed.error).toBe("not_found");
	});

	it("returns undefined for an unknown tool name", () => {
		const tools = makeFakeTools();
		const view = runView(tools, { search: true });
		const resolved = resolveCall(view, "non_existent_tool", {});
		expect(resolved).toBeUndefined();
	});

	it("a pre-pl_ bare name (incident_get) is an unknown tool (#1101)", () => {
		const view = runView(makeFakeTools(), { search: false });
		expect(resolveCall(view, "incident_get", { number: 42 })).toBeUndefined();
	});

	it("pl_tools_call with a bare target name runs the wrapper itself, never the target (#1101)", () => {
		const view = runView(makeFakeTools(), { search: true });
		const resolved = resolveCall(view, TOOLS_CALL, {
			name: "investigations_search",
			arguments: { query: "DB" },
		});
		expect(resolved?.tool.name).toBe(TOOLS_CALL);
	});
});

describe("act tools stay out of search (#1024)", () => {
	const act = defineHarnessTool({
		name: "pl_thread_start",
		title: "Start a thread",
		description: "Starts a thread.",
		group: "knowledge",
		serves: { subjects: EVERY_SUBJECT },
		effect: "act",
		input: z.object({}),
		run: async () => ({ value: { started: true } }),
	});
	const read = defineHarnessTool({
		name: "pl_thread_roster",
		title: "Roster",
		description: "Reads the roster.",
		group: "knowledge",
		serves: { subjects: EVERY_SUBJECT },
		effect: "read",
		input: z.object({}),
		run: async () => ({ value: { members: [] } }),
	});

	it("lists an act tool directly and defers only the read one", () => {
		const view = runView([act, read], { search: true });
		expect(view.direct.map((t) => t.name)).toContain("pl_thread_start");
		expect(view.deferred.map((t) => t.name)).toEqual(["pl_thread_roster"]);
	});

	it("never runs an act tool through pl_tools_call", () => {
		const view = runView([act, read], { search: true });
		const resolved = resolveCall(view, TOOLS_CALL, {
			name: "pl_thread_start",
			arguments: {},
		});
		expect(resolved?.tool.name).toBe(TOOLS_CALL);
		expect(resolveCall(view, TOOLS_CALL, { name: "pl_thread_roster" })?.tool.name).toBe(
			"pl_thread_roster",
		);
	});

	it("auto-allows act tools in the agent's own prompt, since PrismaLens gates them itself", () => {
		const view = runView([act, read], { search: false });
		expect(autoAllowed(view)).toEqual(["pl_thread_start", "pl_thread_roster"]);
	});

	it("autoAllowed leaves out a runsCode tool and keeps the others", () => {
		const runsCode = defineHarnessTool({
			name: "browser_run_script",
			title: "Run script",
			description: "Runs script.",
			group: "core",
			serves: { subjects: EVERY_SUBJECT },
			effect: "act",
			runsCode: true,
			input: z.object({}),
			run: async () => ({ value: { done: true } }),
		});
		const view = runView([act, read, runsCode], { search: false });
		expect(autoAllowed(view)).toEqual(["thread_start", "thread_roster"]);
	});
});
