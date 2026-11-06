// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { runView } from "@prismalens/integrations/harness";
import { describe, expect, it } from "vitest";
import { type GatewayToolData, gatewayTools } from "./index.js";
import { HOUSE_RULES } from "./rules.js";

/** Tool data is only read when a tool runs; describing them needs none. */
const NO_DATA = new Proxy({}, { get: () => ({}) }) as GatewayToolData;
const tools = gatewayTools(NO_DATA);
const every = runView(tools, { search: true }).direct.filter(
	(t) => t.name === "tools_search" || t.name === "tools_call",
);

/** Tools that answer before the work is done: they say so, and that polling is wrong. */
const ASYNC = new Set([
	"thread_start",
	"thread_send",
	"thread_wait",
	"thread_cancel",
	"propose_action",
]);

describe("every tool description follows the checklist (#1024 spec F, decision 6)", () => {
	for (const tool of [...tools, ...every])
		it(`${tool.name}`, () => {
			const d = tool.description;
			expect(d, "when to use it").toMatch(/\bUse it\b/);
			expect(d, "when not to").toMatch(/\bNot for\b/);
			expect(d, "links, not ids; and what `next` means").toContain(HOUSE_RULES);
			if ("requestId" in tool.input.shape)
				expect(d, "its idempotency key").toMatch(/`requestId` is your key/);
			if (ASYNC.has(tool.name) || tool.effect === "act") {
				expect(d, "asynchronous").toMatch(/Asynchronous|never blocks/);
				expect(d, "no polling").toMatch(/[Dd]o not poll/);
			}
		});

	it("covers the old tools and the new ones", () => {
		const names = tools.map((t) => t.name);
		for (const n of ["incident_get", "thread_read", "thread_start", "propose_action"])
			expect(names).toContain(n);
		expect(every.map((t) => t.name).sort()).toEqual(["tools_call", "tools_search"]);
	});
});
