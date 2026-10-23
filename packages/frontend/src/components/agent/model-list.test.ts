// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	agentModels,
	isAgentDefault,
	isFoldedId,
	move,
	pickerModels,
} from "./model-list";

const agent = (entries: { id: string; name: string }[]): HarnessStatus =>
	({
		id: "claude-code",
		label: "Claude Code",
		models: {
			source: "harness",
			asOf: "",
			entries: entries.map((e) => ({ ...e, status: null })),
		},
	}) as HarnessStatus;

const claude = agent([
	{ id: "default", name: "Default (recommended)" },
	{ id: "opus", name: "Opus 5.5" },
	{ id: "sonnet", name: "Sonnet 5.5" },
	{ id: "openrouter/x", name: "X" },
]);

describe("isAgentDefault (#902 f10)", () => {
	it("folds `default` and `Default (recommended)`, not `defaulter`", () => {
		expect(isAgentDefault({ id: "default" })).toBe(true);
		expect(isAgentDefault({ id: "DEFAULT" })).toBe(true);
		expect(isAgentDefault({ id: "x", name: "Default (recommended)" })).toBe(true);
		expect(isAgentDefault({ id: "defaulter", name: "defaulter" })).toBe(false);
		expect(isFoldedId(claude, "default")).toBe(true);
		expect(isFoldedId(claude, "opus")).toBe(false);
		expect(isFoldedId(claude, "")).toBe(false);
	});
});

describe("agentModels", () => {
	it("lists custom ids first, then the agent's own, with the folded default left out", () => {
		expect(agentModels(claude, { custom: ["my-gw", "opus"] }).map((m) => m.id)).toEqual([
			"my-gw",
			"opus",
			"sonnet",
			"openrouter/x",
		]);
	});

	it("holds nothing when the agent lists only its default", () => {
		expect(agentModels(agent([{ id: "default", name: "Default" }]), {})).toEqual([]);
	});

	it("follows the operator's order and ignores ids the agent no longer lists", () => {
		const ids = agentModels(claude, { order: ["gone", "sonnet", "opus"] }).map((m) => m.id);
		expect(ids).toEqual(["sonnet", "opus", "openrouter/x"]);
	});

	it("marks hidden ids, and a hidden id the agent dropped is ignored", () => {
		const list = agentModels(claude, { hidden: ["opus", "gone"] });
		expect(list.filter((m) => m.hidden).map((m) => m.id)).toEqual(["opus"]);
	});
});

describe("pickerModels", () => {
	const base = { favourites: [], chosen: "" };

	it("leaves hidden models out, except the saved choice", () => {
		expect(pickerModels(claude, { ...base, hidden: ["opus"] })).not.toContain("opus");
		expect(pickerModels(claude, { ...base, hidden: ["opus"], chosen: "opus" })).toContain("opus");
	});

	it("puts starred first and keeps the provider grouping with no order", () => {
		const ids = pickerModels(claude, {
			...base,
			favourites: [{ harness: "claude-code", model: "openrouter/x" }],
		});
		expect(ids).toEqual(["openrouter/x", "opus", "sonnet"]);
	});

	it("keeps the operator's order under the stars", () => {
		expect(pickerModels(claude, { ...base, order: ["openrouter/x", "sonnet", "opus"] })).toEqual([
			"openrouter/x",
			"sonnet",
			"opus",
		]);
	});
});

describe("move", () => {
	it("moves one place and stays put at the ends", () => {
		expect(move(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
		expect(move(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
		expect(move(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
		expect(move(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
		expect(move(["a"], "z", 1)).toEqual(["a"]);
	});
});
