// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAgents, staleSources, termsLines } from "./agent-terms.mjs";

const source = (readOn) => ({
	url: "https://acme.test/terms",
	clause: "No bots.",
	readOn,
});
const acme = {
	id: "acme",
	auth: {
		methods: [
			{
				id: "login",
				label: "Acme account",
				terms: {
					runs: "interactive-only",
					source: source("2026-01-02"),
					gaps: ["acme.test/aup"],
				},
			},
			{
				id: "api-key",
				label: "ACME_KEY",
				terms: { runs: "allowed", source: source("2026-11-20") },
			},
		],
		precedence: { first: "env", source: source("2026-11-20") },
	},
};

test("terms prints each path's verdict, clause, URL, read date and gaps, then the precedence", () => {
	assert.deepEqual(termsLines([acme]), [
		"acme",
		"  login (Acme account): interactive-only",
		'    "No bots." https://acme.test/terms (read 2026-01-02)',
		"    not read: acme.test/aup",
		"  api-key (ACME_KEY): allowed",
		'    "No bots." https://acme.test/terms (read 2026-11-20)',
		'  precedence: env first, "No bots." https://acme.test/terms (read 2026-11-20)',
	]);
});

test("terms for an agent the registry lacks fails by name", () => {
	assert.throws(() => termsLines([acme], "nope"), /no agent nope/);
});

test("stale lists every source oldest first and flags those past the window", () => {
	const { all, stale } = staleSources([acme], new Date("2026-11-26"), 90);
	assert.deepEqual(
		all.map((s) => `${s.readOn} ${s.at}`),
		[
			"2026-01-02 acme.login",
			"2026-11-20 acme.api-key",
			"2026-11-20 acme.precedence",
		],
	);
	assert.deepEqual(
		stale.map((s) => s.at),
		["acme.login"],
	);
});

test("the shipped registry answers for Qwen Code's own sign-in", async () => {
	const lines = termsLines(await loadAgents(), "qwen");
	assert.deepEqual(lines.slice(0, 4), [
		"qwen",
		"  login (Qwen account): interactive-only",
		'    "Modifying, copying, leasing, selling, distributing, or manipulating our Service; using bots to access the Service." https://qwen.ai/termsservice (read 2026-11-26)',
		"    not read: qwen.ai/termsservice renders only with JavaScript: read from its bundle g.alicdn.com/qwenweb/qwen-ai-fe/0.0.91/js/9253.js, no browser read",
	]);
});
