// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	annotationsFor,
	executeTool,
	resultValue,
	type ToolOutcome,
} from "@prismalens/integrations/harness";
import { describe, expect, it, vi } from "vitest";
import {
	type BrowserData,
	type BrowserToolCall,
	browserTools,
} from "./browser.js";
import { HOUSE_RULES } from "./rules.js";

const ctx = { runId: "run-1", signal: new AbortController().signal };

function fakeBrowserData() {
	const calls: { runId: string; call: BrowserToolCall }[] = [];
	const data: BrowserData = {
		enabled: vi.fn(async () => true),
		call: vi.fn(
			async (
				runId: string,
				call: BrowserToolCall,
			): Promise<ToolOutcome> => {
				calls.push({ runId, call });
				return { value: { ok: true } };
			},
		),
	};
	return { data, calls };
}

describe("browser tools (#1061)", () => {
	it("Given fake BrowserData, When browserTools is called, Then it returns the eight names in order with world open on all, effect per tool, and runsCode only on run_script", () => {
		const { data } = fakeBrowserData();
		const tools = browserTools(data);
		expect(tools.map((t) => t.name)).toEqual([
			"pl_browser_navigate",
			"pl_browser_snapshot",
			"pl_browser_screenshot",
			"pl_browser_act",
			"pl_browser_tabs",
			"pl_browser_console",
			"pl_browser_network",
			"pl_browser_run_script",
		]);
		expect(tools.map((t) => t.world)).toEqual([
			"open",
			"open",
			"open",
			"open",
			"open",
			"open",
			"open",
			"open",
		]);
		expect(tools.map((t) => t.effect)).toEqual([
			"act",
			"read",
			"read",
			"act",
			"act",
			"read",
			"read",
			"act",
		]);
		expect(tools.map((t) => t.runsCode)).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			true,
		]);
	});

	it("Given browserTools, When checking descriptions, Then every description ends with the house rules and contains Use it", () => {
		const { data } = fakeBrowserData();
		const tools = browserTools(data);
		expect(tools.map((t) => t.description.endsWith(HOUSE_RULES))).toEqual([
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
		]);
		expect(tools.map((t) => t.description.includes("Use it"))).toEqual([
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
		]);
	});

	it("Given browser tools, When called with bad tab id x1 or bad ref, Then executeTool returns invalid_input", async () => {
		const { data } = fakeBrowserData();
		const tools = Object.fromEntries(
			browserTools(data).map((t) => [t.name, t]),
		);

		const badTabCall = await executeTool(
			tools.pl_browser_act,
			{ tab: "x1", action: "click" },
			ctx,
		);
		expect(badTabCall.isError).toBe(true);
		expect(resultValue(badTabCall.output).error).toBe("invalid_input");

		const badRefCall = await executeTool(
			tools.pl_browser_act,
			{ ref: "badref", action: "click" },
			ctx,
		);
		expect(badRefCall.isError).toBe(true);
		expect(resultValue(badRefCall.output).error).toBe("invalid_input");
	});

	it("Given pl_browser_act, When executed with click, double_click, type submit, select, press default key Enter, hover, scroll default direction down, or tab optional, Then it maps each action correctly", async () => {
		const { data, calls } = fakeBrowserData();
		const tools = Object.fromEntries(
			browserTools(data).map((t) => [t.name, t]),
		);

		await executeTool(
			tools.pl_browser_act,
			{ tab: "t1", ref: "e1", action: "click" },
			ctx,
		);
		expect(calls[0]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_act",
				tab: "t1",
				ref: "e1",
				action: { kind: "click", double: false },
			},
		});

		await executeTool(
			tools.pl_browser_act,
			{ tab: "t1", ref: "e2", action: "double_click" },
			ctx,
		);
		expect(calls[1]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_act",
				tab: "t1",
				ref: "e2",
				action: { kind: "click", double: true },
			},
		});

		await executeTool(
			tools.pl_browser_act,
			{ tab: "t1", ref: "e3", action: "type", text: "query", submit: true },
			ctx,
		);
		expect(calls[2]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_act",
				tab: "t1",
				ref: "e3",
				action: { kind: "type", text: "query", submit: true },
			},
		});

		await executeTool(
			tools.pl_browser_act,
			{ tab: "t1", ref: "e4", action: "select", values: ["v1", "v2"] },
			ctx,
		);
		expect(calls[3]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_act",
				tab: "t1",
				ref: "e4",
				action: { kind: "select", values: ["v1", "v2"] },
			},
		});

		await executeTool(
			tools.pl_browser_act,
			{ tab: "t1", action: "press" },
			ctx,
		);
		expect(calls[4]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_act",
				tab: "t1",
				ref: undefined,
				action: { kind: "press", key: "Enter" },
			},
		});

		await executeTool(
			tools.pl_browser_act,
			{ tab: "t1", ref: "e5", action: "hover" },
			ctx,
		);
		expect(calls[5]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_act",
				tab: "t1",
				ref: "e5",
				action: { kind: "hover" },
			},
		});

		await executeTool(
			tools.pl_browser_act,
			{ tab: "t1", action: "scroll" },
			ctx,
		);
		expect(calls[6]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_act",
				tab: "t1",
				ref: undefined,
				action: { kind: "scroll", direction: "down" },
			},
		});

		await executeTool(
			tools.pl_browser_act,
			{ action: "hover" },
			ctx,
		);
		expect(calls[7]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_act",
				tab: undefined,
				ref: undefined,
				action: { kind: "hover" },
			},
		});
	});

	it("Given browser tools, When executed with executeTool, Then navigate, snapshot, screenshot, tabs, console, network, and run_script pass the exact BrowserToolCall with schema defaults and optional tab", async () => {
		const { data, calls } = fakeBrowserData();
		const tools = Object.fromEntries(
			browserTools(data).map((t) => [t.name, t]),
		);

		await executeTool(
			tools.pl_browser_navigate,
			{ to: "https://example.com" },
			ctx,
		);
		expect(calls[0]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_navigate",
				tab: undefined,
				to: "https://example.com",
			},
		});

		await executeTool(
			tools.pl_browser_snapshot,
			{},
			ctx,
		);
		expect(calls[1]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_snapshot",
				tab: undefined,
			},
		});

		await executeTool(
			tools.pl_browser_screenshot,
			{},
			ctx,
		);
		expect(calls[2]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_screenshot",
				tab: undefined,
				ref: undefined,
			},
		});

		await executeTool(
			tools.pl_browser_tabs,
			{},
			ctx,
		);
		expect(calls[3]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_tabs",
				action: "list",
				tab: undefined,
				url: undefined,
			},
		});

		await executeTool(
			tools.pl_browser_console,
			{},
			ctx,
		);
		expect(calls[4]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_console",
				tab: undefined,
				level: "all",
				limit: 50,
			},
		});

		await executeTool(
			tools.pl_browser_network,
			{},
			ctx,
		);
		expect(calls[5]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_network",
				tab: undefined,
				filter: undefined,
				failed: false,
				limit: 50,
			},
		});

		await executeTool(
			tools.pl_browser_run_script,
			{ script: "() => 1" },
			ctx,
		);
		expect(calls[6]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_run_script",
				tab: undefined,
				script: "() => 1",
				ref: undefined,
			},
		});
	});

	it("Given annotationsFor, When called for read open-world, act open-world, and read with runsCode, Then it returns readOnlyHint true with openWorldHint true, act with destructive form, and runsCode with destructive form", () => {
		expect(annotationsFor("read", "open")).toEqual({
			readOnlyHint: true,
			openWorldHint: true,
		});
		expect(annotationsFor("act", "open")).toEqual({
			readOnlyHint: false,
			destructiveHint: true,
			openWorldHint: true,
		});
		expect(annotationsFor("read", "open", true)).toEqual({
			readOnlyHint: false,
			destructiveHint: true,
			openWorldHint: true,
		});
	});
});
