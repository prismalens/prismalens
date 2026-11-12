// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	humanizeTool,
	PL_TOOL_DEFS,
	PL_TOOLS,
	plTool,
	TOOL_KINDS,
} from "./tools.js";

describe("tool registry guard tests (#1125)", () => {
	it("no two entries in PL_TOOL_DEFS share a name, and PL_TOOLS keys match PL_TOOL_DEFS names", () => {
		const names = PL_TOOL_DEFS.map((d) => d.name);
		expect(new Set(names).size).toBe(PL_TOOL_DEFS.length);
		expect(Object.keys(PL_TOOLS).sort()).toEqual([...names].sort());
	});

	it("every entry's kind is in TOOL_KINDS, label.step matches the step format, and no label contains raw tool prefixes", () => {
		const stepPattern = /^[A-Z][a-z]+( [A-Za-z]+){1,4}$/;
		const validKinds = new Set<string>(TOOL_KINDS);

		for (const def of PL_TOOL_DEFS) {
			expect(validKinds.has(def.kind), `${def.name} kind in TOOL_KINDS`).toBe(
				true,
			);
			expect(
				stepPattern.test(def.label.step),
				`${def.name} label.step "${def.label.step}" matches pattern`,
			).toBe(true);

			for (const [key, val] of Object.entries(def.label)) {
				expect(val, `${def.name} label.${key} has no raw tool id`).not.toMatch(
					/pl_|mcp__/,
				);
			}

		}
	});

	it("plTool resolves legacy names like tools_call to pl_tools_call and returns undefined for foreign tools like Bash", () => {
		expect(plTool("tools_call")?.name).toBe("pl_tools_call");
		expect(plTool("Bash")).toBeUndefined();
	});

	it("humanizeTool capitalizes words and strips pl_ prefix", () => {
		expect(humanizeTool("browser_run_script")).toBe("Browser run script");
		expect(humanizeTool("pl_thread_start")).toBe("Thread start");
	});
});
