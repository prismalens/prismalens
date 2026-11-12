// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { inputSchemaOf, runView } from "@prismalens/integrations/harness";
import { describe, expect, it } from "vitest";
import { type GatewayToolData, gatewayTools } from "./index.js";
import { HOUSE_RULES } from "./rules.js";

/** Tool data is only read when a tool runs; describing them needs none. */
const NO_DATA = new Proxy({}, { get: () => ({}) }) as GatewayToolData;
const tools = gatewayTools(NO_DATA);
const every = runView(tools, { search: true }).direct.filter(
	(t) => t.name === "pl_tools_search" || t.name === "pl_tools_call",
);

/** Tools that answer before the work is done: they say so, and that polling is wrong. */
const ASYNC = new Set([
	"pl_thread_start",
	"pl_thread_send",
	"pl_thread_wait",
	"pl_thread_cancel",
	"pl_propose_action",
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
		for (const n of ["pl_incident_get", "pl_thread_read", "pl_thread_start", "pl_propose_action"])
			expect(names).toContain(n);
		expect(every.map((t) => t.name).sort()).toEqual(["pl_tools_call", "pl_tools_search"]);
	});

	it("the summed description and schema characters of PR and cron tools divided by 4 is under 2500 tokens", () => {
		const targetNames = [
			"pl_pr_link",
			"pl_pr_watch",
			"pl_pr_unwatch",
			"pl_wakeup_schedule",
			"pl_cron_create",
			"pl_cron_list",
			"pl_cron_delete",
		];
		const subset = tools.filter((t) => targetNames.includes(t.name));
		expect(subset.map((t) => t.name).sort()).toEqual([...targetNames].sort());
		const totalChars = subset.reduce(
			(sum, t) => sum + t.description.length + JSON.stringify(inputSchemaOf(t)).length,
			0,
		);
		const tokens = totalChars / 4;
		expect(tokens).toBeLessThan(2500);
	});
});
