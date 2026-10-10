// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { exactRule, scopeSeries } from "./series-scope.js";

const rule = (query: string, labels: Record<string, string> = {}) => ({
	name: "Slow",
	query,
	labels,
});
const s = (labels: Record<string, string>) => ({ labels });

describe("exactRule", () => {
	it("takes the one rule whose query is the expression byte for byte", () => {
		expect(exactRule([rule("x > 1"), rule("x > 2")], "x > 1")?.query).toBe("x > 1");
		expect(exactRule([rule("x > 1 ")], "x > 1")).toBeNull();
		expect(exactRule([rule("x > 1"), rule("x > 1")], "x > 1")).toBeNull();
		expect(exactRule([], "x > 1")).toBeNull();
	});
});

describe("scopeSeries", () => {
	const alert = { alertname: "Slow", instance: "a:9100", job: "node", severity: "page" };

	it("is unscoped with no matched rule", () => {
		const all = [s({ instance: "a:9100" }), s({ instance: "b:9100" })];
		expect(scopeSeries(all, alert, null)).toEqual({ state: "unscoped", series: all, matched: 0 });
	});

	it("scopes the one series whose labels the alert carries, ignoring __name__ and rule labels", () => {
		const mine = s({ __name__: "node_load1", instance: "a:9100", job: "node" });
		const other = s({ __name__: "node_load1", instance: "b:9100", job: "node" });
		expect(scopeSeries([mine, other], alert, rule("node_load1 > 4", { severity: "page" }))).toEqual({
			state: "scoped",
			series: [mine],
			matched: 1,
		});
	});

	it("refuses to scope when the rule overwrote a label a series carries", () => {
		const all = [s({ instance: "a:9100" }), s({ instance: "b:9100" })];
		const r = rule("x > 1", { instance: "a:9100" });
		expect(scopeSeries(all, alert, r).state).toBe("unscoped");
	});

	it("says several when more than one series fits", () => {
		const all = [s({ job: "node" }), s({ job: "node", instance: "a:9100" })];
		expect(scopeSeries(all, alert, rule("x > 1"))).toMatchObject({ state: "several", matched: 2 });
	});

	it("falls back to unscoped when none fits", () => {
		const all = [s({ instance: "c:9100" })];
		expect(scopeSeries(all, alert, rule("x > 1"))).toEqual({ state: "unscoped", series: all, matched: 0 });
	});
});
