// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSources, loadAgents, plain, termsLines } from "./agent-terms.mjs";

const source = (url, clause) => ({ url, clause, readOn: "2026-11-26" });
const method = (id, runs, s, extra = {}) => ({
	id,
	label: id.toUpperCase(),
	terms: { runs, source: s, ...extra },
});
const acme = {
	id: "acme",
	auth: {
		methods: [
			method(
				"login",
				"interactive-only",
				source("https://acme.test/terms", "No bots."),
				{
					against: source("https://acme.test/blog", "Bots welcome."),
					gaps: ["acme.test/aup"],
				},
			),
			method(
				"api-key",
				"allowed",
				source("https://acme.test/terms", "Keys are for programs."),
			),
		],
	},
};
const words = (n) => Array.from({ length: n }, () => "filler").join(" ");

test("terms prints each path's verdict, clause, URL, read date, counter-clause and gaps", () => {
	assert.deepEqual(termsLines([acme]), [
		"acme",
		"  login (LOGIN): interactive-only",
		'    "No bots." https://acme.test/terms (read 2026-11-26)',
		'    against: "Bots welcome." https://acme.test/blog (read 2026-11-26)',
		"    not read: acme.test/aup",
		"  api-key (API-KEY): allowed",
		'    "Keys are for programs." https://acme.test/terms (read 2026-11-26)',
	]);
});

test("terms for an agent the registry lacks fails by name", () => {
	assert.throws(() => termsLines([acme], "nope"), /no agent nope/);
});

test("check reads each page once and marks a clause present, changed, or unreadable", async () => {
	const fetched = [];
	const pages = {
		"https://acme.test/terms": `<p>No&nbsp;bots.</p> ${words(300)}`,
		"https://acme.test/blog": `<p>Bots are now banned.</p> ${words(300)}`,
	};
	const results = await checkSources([acme], async (url) => {
		fetched.push(url);
		return pages[url];
	});
	assert.deepEqual(
		results.map((r) => `${r.at} ${r.state}`),
		["acme.login present", "acme.login changed", "acme.api-key changed"],
	);
	assert.deepEqual(fetched, [
		"https://acme.test/terms",
		"https://acme.test/blog",
	]);
});

test("check calls a failed fetch or a script-filled shell unreadable, never changed", async () => {
	const one = {
		id: "a",
		auth: {
			methods: [
				method("login", "allowed", source("https://a.test/t", "No bots.")),
			],
		},
	};
	const failed = await checkSources([one], async () => {
		throw new Error("HTTP 403");
	});
	const shell = await checkSources(
		[one],
		async () => '<div id="root"></div><script>render("No bots.")</script>',
	);
	assert.deepEqual(
		[failed[0].state, shell[0].state],
		["unreadable", "unreadable"],
	);
});

test("check calls a short page with no script changed when its clause is gone", async () => {
	const one = {
		id: "a",
		auth: {
			methods: [
				method("login", "allowed", source("https://a.test/t", "No bots.")),
			],
		},
	};
	const short = await checkSources(
		[one],
		async () => "<h1>Terms.</h1><p>Automation is prohibited.</p>",
	);
	assert.equal(short[0].state, "changed");
});

test("plain makes markup, Markdown links, entities, curly quotes and code marks comparable", () => {
	assert.equal(
		plain(
			"[Headless mode](../cli/headless.md) uses `agy acp`&#x27;s <b>cached</b> ‘sign-in’ ,\n  as &quot;said&quot;.",
		),
		`Headless mode uses agy acp's cached 'sign-in', as "said".`,
	);
});

test("check fetches a GitHub blob as its raw file", async () => {
	const fetched = [];
	const blob = {
		id: "a",
		auth: {
			methods: [
				method(
					"login",
					"allowed",
					source("https://github.com/o/r/blob/main/docs/a.md", "No bots."),
				),
			],
		},
	};
	await checkSources([blob], async (url) => {
		fetched.push(url);
		return "No bots.";
	});
	assert.deepEqual(fetched, [
		"https://raw.githubusercontent.com/o/r/main/docs/a.md",
	]);
});

test("the shipped registry answers for Qwen Code's own sign-in", async () => {
	const lines = termsLines(await loadAgents(), "qwen");
	assert.deepEqual(lines.slice(0, 4), [
		"qwen",
		"  login (Qwen account): interactive-only",
		'    "Modifying, copying, leasing, selling, distributing, or manipulating our Service; using bots to access the Service." https://qwen.ai/termsservice (read 2026-11-26)',
		"  coding-plan (Alibaba Coding Plan key (sk-sp-)): interactive-only",
	]);
});
