// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { validateFixtures } from "@copilotkit/aimock";
import { HARNESS_IDS } from "@prismalens/config/harness";
import { describe, expect, it } from "vitest";
import {
	agentTools,
	fixturesFor,
	matrixRows,
	SCENARIOS_DIR,
} from "../../../../scripts/fakes/scripted-model.mjs";

const AGENTS = ["opencode", "claude-code", "codex", "gemini", "deepagents"];

function jsonFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return jsonFiles(path);
		return name.endsWith(".json") ? [path] : [];
	});
}

/** Keys an agent's request carries; a fixture holding one holds a copy of it. */
const REQUEST_KEYS = new Set([
	"request",
	"body",
	"headers",
	"messages",
	"system",
	"systemMessage",
	"systemInstruction",
	"instructions",
	"tools",
	"contents",
]);
/**
 * A match string is a marker of ours or a few words of an agent's prompt, never more:
 * 80 characters is twice the longest marker in use. A response string is our own text.
 */
const MATCH_STRING_MAX = 80;
const STRING_MAX = 400;

function problemsIn(
	value: unknown,
	path: string[],
	inMatch: boolean,
): string[] {
	if (typeof value === "string") {
		const max = inMatch ? MATCH_STRING_MAX : STRING_MAX;
		const prose = path.at(-1) === "description" || path.at(-1) === "why";
		return value.length > max && !prose
			? [`${path.join(".")} is ${value.length} characters (max ${max})`]
			: [];
	}
	if (Array.isArray(value))
		return value.flatMap((v, i) => problemsIn(v, [...path, String(i)], inMatch));
	if (value && typeof value === "object")
		return Object.entries(value).flatMap(([k, v]) => [
			...(REQUEST_KEYS.has(k) ? [`${[...path, k].join(".")} is a request key`] : []),
			...problemsIn(v, [...path, k], inMatch || k === "match"),
		]);
	return [];
}

describe("committed scenario fixtures hold only our text (#914)", () => {
	const files = jsonFiles(SCENARIOS_DIR);

	it("finds the fixture files", () => {
		expect(files.length).toBeGreaterThan(10);
	});

	it.each(files.map((f) => [relative(SCENARIOS_DIR, f), f]))(
		"%s carries no agent request body",
		(_name, file) => {
			const json: unknown = JSON.parse(readFileSync(file, "utf8"));
			expect(problemsIn(json, [], false)).toEqual([]);
		},
	);

	it("fails on a fixture that copies a request", () => {
		const copied = {
			fixtures: [
				{
					match: { userMessage: "x".repeat(81) },
					response: { content: "ok" },
					request: { system: "You are Claude Code", tools: [] },
				},
			],
		};
		expect(problemsIn(copied, [], false)).toEqual([
			"fixtures.0.match.userMessage is 81 characters (max 80)",
			"fixtures.0.request is a request key",
			"fixtures.0.request.system is a request key",
			"fixtures.0.request.tools is a request key",
		]);
	});
});

describe("the behaviour matrix is well formed (#914)", () => {
	const rows = matrixRows();

	it("maps the shell tool of every agent", () => {
		expect(Object.keys(agentTools()).sort()).toEqual([...AGENTS].sort());
	});

	it.each(AGENTS)("serves %s fixtures aimock accepts", (agent) => {
		const errors = validateFixtures(fixturesFor(agent)).filter(
			(p) => p.severity === "error",
		);
		expect(errors).toEqual([]);
	});

	it.each(rows.map((r) => [r.row, r]))(
		"%s names only known agents, and its marker",
		(name, row) => {
			for (const agent of [
				...Object.keys(row.agents ?? {}),
				...Object.keys(row.na ?? {}),
			])
				expect(HARNESS_IDS).toContain(agent);
			for (const f of row.fixtures)
				expect(JSON.stringify(f.match)).toContain(`[row:${name}]`);
		},
	);

	it("has one row per behaviour #914 names", () => {
		expect(rows.map((r) => r.row).sort()).toEqual(
			[
				"report",
				"tool-call",
				"permission-allowed",
				"permission-declined",
				"cancel",
				"not-signed-in",
				"modes",
				"invalid-tool-args",
				"unknown-tool",
				"empty-response",
				"length-cutoff",
				"refusal",
				"http-500",
				"http-429",
				"stream-dropped",
				"slow-first-token",
				"parallel-tool-calls",
				"gateway-read",
				"gateway-knowledge",
				"gateway-record",
				"gateway-failure",
			].sort(),
		);
	});
});
