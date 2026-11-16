// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { type GatewayToolData, gatewayTools } from "./index.js";
import { type BrowserData, browserTools } from "./browser.js";
import { TOOLS_CALL, TOOLS_SEARCH } from "@prismalens/integrations/harness";
import { PL_TOOLS } from "@prismalens/contracts/schemas";

const NO_DATA = new Proxy({}, { get: () => ({}) }) as GatewayToolData;

const STUB_BROWSER_DATA: BrowserData = {
	enabled: async () => true,
	call: async () => ({ value: {} }),
};

describe("gateway tool registry coverage (#1125)", () => {
	it("every served tool has a registry entry in PL_TOOLS", () => {
		const registeredTools = [
			...gatewayTools(NO_DATA),
			...browserTools(STUB_BROWSER_DATA),
		];
		const servedNames = [
			...registeredTools.map((t) => t.name),
			TOOLS_SEARCH,
			TOOLS_CALL,
		];

		const sortedServed = [...new Set(servedNames)].sort();
		const sortedRegistry = Object.keys(PL_TOOLS).sort();

		expect(sortedServed).toEqual(sortedRegistry);
	});

	it("every registered tool matches PL_TOOLS title, describe, and access", () => {
		const registeredTools = [
			...gatewayTools(NO_DATA),
			...browserTools(STUB_BROWSER_DATA),
		];

		for (const tool of registeredTools) {
			const expected = PL_TOOLS[tool.name as keyof typeof PL_TOOLS];
			expect(tool.title, `${tool.name} title`).toBe(expected.title);
			expect(tool.description, `${tool.name} description`).toBe(
				expected.describe,
			);
			expect(tool.effect, `${tool.name} effect`).toBe(expected.access);
		}
	});
});
