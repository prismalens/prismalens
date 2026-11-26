// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	agentModels,
	favouritesFirst,
	filterModels,
	isAgentDefault,
	isFoldedId,
	modelLabels,
	move,
	pickerModels,
	toggleFavourite,
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

describe("filterModels (#1180)", () => {
	const rows = [
		{ id: "opus", name: "Opus 5.5", provider: "Anthropic" },
		{ id: "openrouter/x", name: "X", provider: "OpenRouter" },
		{ id: "gpt-6", name: "GPT 6", provider: "OpenAI" },
		{ id: "gw-a", name: "Atlas", provider: "Gateway" },
	];
	it("keeps the rows whose name, id or provider holds every word, ignoring case", () => {
		expect(filterModels(rows, "OPUS").map((r) => r.id)).toEqual(["opus"]);
		expect(filterModels(rows, "atlas").map((r) => r.id)).toEqual(["gw-a"]);
		expect(filterModels(rows, "openrouter/").map((r) => r.id)).toEqual([
			"openrouter/x",
		]);
		expect(filterModels(rows, "open ai").map((r) => r.id)).toEqual(["gpt-6"]);
		expect(filterModels(rows, "  ").map((r) => r.id)).toEqual([
			"opus",
			"openrouter/x",
			"gpt-6",
			"gw-a",
		]);
	});
});

describe("favourites (#1180)", () => {
	it("toggle adds at the end and removes in place, leaving other agents' favourites", () => {
		const start = [
			{ harness: "codex" as const, model: "opus" },
			{ harness: "claude-code" as const, model: "opus" },
		];
		expect(toggleFavourite(start, "claude-code", "sonnet")).toEqual([
			...start,
			{ harness: "claude-code", model: "sonnet" },
		]);
		expect(toggleFavourite(start, "claude-code", "opus")).toEqual([
			{ harness: "codex", model: "opus" },
		]);
	});

	it("puts this agent's favourites first in list order, not another agent's", () => {
		const favs = [
			{ harness: "claude-code" as const, model: "x" },
			{ harness: "codex" as const, model: "opus" },
			{ harness: "claude-code" as const, model: "sonnet" },
		];
		expect(favouritesFirst(["opus", "sonnet", "haiku", "x"], favs, "claude-code")).toEqual([
			{ id: "sonnet", favourite: true },
			{ id: "x", favourite: true },
			{ id: "opus", favourite: false },
			{ id: "haiku", favourite: false },
		]);
	});
});

describe("modelLabels (#1180)", () => {
	it("a listed model with no effort selector and no evidence has no label", () => {
		expect(modelLabels("claude-code", "opus")).toEqual([]);
	});

	it("Claude Code's [1m] id shows its own window size", () => {
		expect(modelLabels("claude-code", "opus[1m]")).toEqual([
			{ label: "large-context", word: "1M context" },
		]);
		// Another agent's id with the same suffix proves nothing.
		expect(modelLabels("codex", "gpt[1m]")).toEqual([]);
	});

	it("Fast only for the model the agent listed a Fast mode for; custom labels as the person gave them", () => {
		expect(modelLabels("claude-code", "opus", { fastModel: "opus" })).toEqual([
			{ label: "fast", word: "Fast" },
		]);
		expect(modelLabels("claude-code", "sonnet", { fastModel: "opus" })).toEqual([]);
		expect(
			modelLabels("opencode", "local/q", {
				custom: { id: "local/q", labels: ["large-context", "no-reasoning"] },
			}),
		).toEqual([
			{ label: "no-reasoning", word: "No reasoning" },
			{ label: "large-context", word: "Large context" },
		]);
	});
});
