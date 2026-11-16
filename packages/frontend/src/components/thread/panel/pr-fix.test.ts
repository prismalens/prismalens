// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { checkFixMessage, FIX_LOG_LINES, reviewFixMessage } from "./pr-fix";

describe("checkFixMessage (#1101)", () => {
	it("returns exact message with step and log", () => {
		const pr = { number: 42, repo: "org/repo", headSha: "abcdef123456" };
		const run = { name: "test", headSha: "abcdef123456" };
		const log = {
			step: "Run vitest",
			lines: ["error line 1", "error line 2"],
		};
		const expected = [
			'The check "test" fails on PR #42 (org/repo) at abcdef1.',
			'It fails at the step "Run vitest".',
			"Log excerpt:\n```\nerror line 1\nerror line 2\n```",
			"Find the cause, fix it on this branch and push.",
		].join("\n\n");
		expect(checkFixMessage(pr, run, log)).toBe(expected);
	});

	it("returns exact message with neither step nor log", () => {
		const pr = { number: 42, repo: "org/repo", headSha: null };
		const run = { name: "lint" };
		const expected = [
			'The check "lint" fails on PR #42 (org/repo) at the current head.',
			"Find the cause, fix it on this branch and push.",
		].join("\n\n");
		expect(checkFixMessage(pr, run, null)).toBe(expected);
	});

	it("keeps only the last 15 log lines in the excerpt", () => {
		expect(FIX_LOG_LINES).toBe(15);
		const pr = { number: 10, repo: "acme/api", headSha: "1234567890" };
		const run = { name: "build", headSha: "1234567890" };
		const allLines = Array.from({ length: 20 }, (_, i) => `log line ${i + 1}`);
		const keptLines = allLines.slice(-15);
		const log = {
			step: null,
			lines: allLines,
		};
		const expected = [
			'The check "build" fails on PR #10 (acme/api) at 1234567.',
			`Log excerpt:\n\`\`\`\n${keptLines.join("\n")}\n\`\`\``,
			"Find the cause, fix it on this branch and push.",
		].join("\n\n");
		expect(checkFixMessage(pr, run, log)).toBe(expected);
	});
});

describe("reviewFixMessage (#1101)", () => {
	it("returns exact message with a line", () => {
		const pr = { number: 100, repo: "owner/repo", headSha: "deadbeef00" };
		const thread = {
			id: "t1",
			path: "src/api.ts",
			line: 42,
			author: "alice",
			excerpt: "Please fix this null check\nsecond line",
			replies: 0,
			resolved: false,
			outdated: false,
		};
		const expected = [
			"@alice left a review thread on src/api.ts:42 in PR #100 (owner/repo), head deadbee:",
			"> Please fix this null check\n> second line",
			"Address it on this branch, push, and say what you changed.",
		].join("\n\n");
		expect(reviewFixMessage(pr, thread)).toBe(expected);
	});

	it("returns exact message without a line", () => {
		const pr = { number: 100, repo: "owner/repo", headSha: "deadbeef00" };
		const thread = {
			id: "t2",
			path: "README.md",
			line: null,
			author: "bob",
			excerpt: "Typo in title",
			replies: 1,
			resolved: false,
			outdated: false,
		};
		const expected = [
			"@bob left a review thread on README.md in PR #100 (owner/repo), head deadbee:",
			"> Typo in title",
			"Address it on this branch, push, and say what you changed.",
		].join("\n\n");
		expect(reviewFixMessage(pr, thread)).toBe(expected);
	});
});
