// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { toolTitle } from "./tool-title";
import { humanizeTool, PL_TOOLS } from "@prismalens/contracts";

describe("toolTitle ask dock titles (#1125)", () => {
	it("never shows a raw id for any PL_TOOLS name with or without mcp prefix", () => {
		for (const name of Object.keys(PL_TOOLS) as (keyof typeof PL_TOOLS)[]) {
			const def = PL_TOOLS[name];
			const expected = def.label.ask ?? humanizeTool(name);

			const prefixed = toolTitle(`mcp__prismalens__${name}`);
			expect(prefixed.includes("pl_"), `${name} prefixed has no pl_`).toBe(
				false,
			);
			expect(prefixed.includes("mcp__"), `${name} prefixed has no mcp__`).toBe(
				false,
			);
			expect(prefixed, `${name} prefixed matches expected title`).toBe(
				expected,
			);

			const unprefixed = toolTitle(name);
			expect(unprefixed.includes("pl_"), `${name} unprefixed has no pl_`).toBe(
				false,
			);
			expect(
				unprefixed.includes("mcp__"),
				`${name} unprefixed has no mcp__`,
			).toBe(false);
			expect(unprefixed, `${name} unprefixed matches expected title`).toBe(
				expected,
			);
		}
	});

	it("translates mcp__prismalens__pl_browser_run_script to Run a script on the page", () => {
		expect(toolTitle("mcp__prismalens__pl_browser_run_script")).toBe(
			"Run a script on the page",
		);
	});

	it("formats another server's tool as words and server name", () => {
		expect(toolTitle("mcp__tracker__create_issue")).toBe("Create issue · tracker");
	});

	it("passes through a title that is already words", () => {
		expect(toolTitle("Run tests")).toBe("Run tests");
	});
});
