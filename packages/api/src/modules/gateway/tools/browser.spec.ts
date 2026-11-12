// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	annotationsFor,
	type ToolOutcome,
} from "@prismalens/integrations/harness";
import { describe, expect, it, vi } from "vitest";
import {
	type BrowserData,
	type BrowserToolCall,
	browserTools,
} from "./browser.js";

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
	it("Given fake BrowserData, When browserTools is called, Then it returns tools with the six names", () => {
		const { data } = fakeBrowserData();
		const tools = browserTools(data);
		expect(tools.map((t) => t.name)).toEqual([
			"pl_browser_open",
			"pl_browser_navigate",
			"pl_browser_snapshot",
			"pl_browser_act",
			"pl_browser_tabs",
			"pl_browser_close",
		]);
	});

	it("Given pl_browser_act, When called with double_click, type with submit, press without key, or select, Then it maps each action correctly", async () => {
		const { data, calls } = fakeBrowserData();
		const tools = browserTools(data);
		const actTool = tools.find((t) => t.name === "pl_browser_act");
		if (!actTool) throw new Error("pl_browser_act tool missing");

		await actTool.run({ tab: "t1", action: "double_click" }, ctx);
		expect(calls[0]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_act",
				tab: "t1",
				ref: undefined,
				action: { kind: "click", double: true },
			},
		});

		await actTool.run(
			{ tab: "t1", action: "type", text: "query text", submit: true },
			ctx,
		);
		expect(calls[1]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_act",
				tab: "t1",
				ref: undefined,
				action: { kind: "type", text: "query text", submit: true },
			},
		});

		await actTool.run({ tab: "t1", action: "press" }, ctx);
		expect(calls[2]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_act",
				tab: "t1",
				ref: undefined,
				action: { kind: "press", key: "Enter" },
			},
		});

		await actTool.run(
			{ tab: "t1", action: "select", values: ["val1", "val2"] },
			ctx,
		);
		expect(calls[3]).toEqual({
			runId: "run-1",
			call: {
				tool: "pl_browser_act",
				tab: "t1",
				ref: undefined,
				action: { kind: "select", values: ["val1", "val2"] },
			},
		});
	});

	it("Given tab id inputs 1 and tab1, When safeParse is evaluated, Then it rejects both and accepts t1", () => {
		const { data } = fakeBrowserData();
		const tools = browserTools(data);
		const actTool = tools.find((t) => t.name === "pl_browser_act");
		if (!actTool) throw new Error("pl_browser_act tool missing");

		expect(actTool.input.safeParse({ tab: "1", action: "click" }).success).toBe(
			false,
		);
		expect(
			actTool.input.safeParse({ tab: "tab1", action: "click" }).success,
		).toBe(false);
		expect(
			actTool.input.safeParse({ tab: "t1", action: "click" }).success,
		).toBe(true);
	});

	it("Given browser tools, When checking effect and world, Then open, navigate, act and close are act with world open, while snapshot and tabs are read", () => {
		const { data } = fakeBrowserData();
		const tools = Object.fromEntries(
			browserTools(data).map((t) => [t.name, t]),
		);

		expect(tools.pl_browser_open?.effect).toBe("act");
		expect(tools.pl_browser_open?.world).toBe("open");
		expect(tools.pl_browser_navigate?.effect).toBe("act");
		expect(tools.pl_browser_navigate?.world).toBe("open");
		expect(tools.pl_browser_act?.effect).toBe("act");
		expect(tools.pl_browser_act?.world).toBe("open");
		expect(tools.pl_browser_close?.effect).toBe("act");
		expect(tools.pl_browser_close?.world).toBe("open");

		expect(tools.pl_browser_snapshot?.effect).toBe("read");
		expect(tools.pl_browser_snapshot?.world).toBeUndefined();
		expect(tools.pl_browser_tabs?.effect).toBe("read");
		expect(tools.pl_browser_tabs?.world).toBeUndefined();
	});

	it("Given effect act and world open, When annotationsFor is called, Then it returns readOnlyHint false, destructiveHint true, and openWorldHint true", () => {
		expect(annotationsFor("act", "open")).toEqual({
			readOnlyHint: false,
			destructiveHint: true,
			openWorldHint: true,
		});
	});
});
