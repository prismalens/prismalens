// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { scopeOptions, scopeSearch, scopeValue } from "./DiffSurface";

const TURNS = [{ seq: 4 }, { seq: 9 }, { seq: 15 }];

describe("the diff scope picker (#1101 category 16)", () => {
	it("lists the four scopes, then each earlier turn under Earlier turns", () => {
		expect(
			scopeOptions(TURNS).map((o) => [o.id, o.name, o.group ?? ""]),
		).toEqual([
			["all", "All vs base", ""],
			["turn", "This turn", ""],
			["uncommitted", "Uncommitted", ""],
			["outside", "Outside turns", ""],
			["turn:4", "Turn 1", "Earlier turns"],
			["turn:9", "Turn 2", "Earlier turns"],
		]);
	});

	it("reads the latest turn as This turn and an earlier one by its seq", () => {
		expect(scopeValue("turn", 15, TURNS)).toBe("turn");
		expect(scopeValue("turn", undefined, TURNS)).toBe("turn");
		expect(scopeValue("turn", 9, TURNS)).toBe("turn:9");
		expect(scopeValue("outside", 9, TURNS)).toBe("outside");
	});

	it("turns a picked id back into the panel search", () => {
		expect(scopeSearch("turn:9")).toEqual({ scope: "turn", turn: 9 });
		expect(scopeSearch("turn")).toEqual({ scope: "turn" });
		expect(scopeSearch("uncommitted")).toEqual({ scope: "uncommitted" });
	});
});
