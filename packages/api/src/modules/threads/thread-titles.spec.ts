// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import {
	agentTitle,
	cutAtWord,
	generatedTitle,
	instantTitle,
	plainTitle,
	renameThread,
	setAgentTitle,
	setGeneratedTitle,
	titlePrompt,
} from "./thread-titles.js";

describe("plainTitle (#1020)", () => {
	it("keeps one line of plain text: no controls, no bidi overrides, one space between words", () => {
		expect(plainTitle("  Fix\tthe \n\r retry \u0007loop‮  ")).toBe(
			"Fix the retry loop",
		);
	});

	it("keeps markup as the characters typed, for the page to show as text", () => {
		expect(plainTitle("<img src=x onerror=alert(1)> retry")).toBe(
			"<img src=x onerror=alert(1)> retry",
		);
	});

	it("drops a credential from an address", () => {
		expect(plainTitle("Pull https://bob:hunter2@git.example.com/shop fails")).toBe(
			"Pull https://git.example.com/shop fails",
		);
	});

	it("caps at 80 characters", () => {
		const capped = plainTitle("word ".repeat(40));
		expect(capped.length).toBeLessThanOrEqual(80);
		expect(capped).toMatch(/^word( word)+$/);
		expect(plainTitle("x".repeat(100))).toHaveLength(80);
	});
});

describe("joiners stay inside words (review of #1031)", () => {
	it("keeps ZWNJ and ZWJ, still drops bidi overrides", () => {
		const persian = "می‌خواهم";
		const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
		expect(plainTitle(`Fix ${persian} ${family} now`)).toBe(
			`Fix ${persian} ${family} now`,
		);
		expect(plainTitle("evil‮txt.exe")).toBe("evil txt.exe");
		expect(agentTitle(`Fix the ${persian} page`)).toEqual({
			title: `Fix the ${persian} page`,
		});
	});
});

describe("joiner-only text is no title (review of #1040)", () => {
	it("drops words made only of joiners, so nothing invisible is kept or counted", async () => {
		const zwj = String.fromCodePoint(0x200d);
		const zwnj = String.fromCodePoint(0x200c);
		expect(plainTitle(zwj)).toBe("");
		expect(plainTitle(`Fix ${zwj}${zwnj} it`)).toBe("Fix it");
		expect(agentTitle(`${zwj} ${zwj} ${zwj}`)).toMatchObject({ error: expect.any(String) });
		expect(agentTitle(`Fix ${zwj} the ${zwnj} page`)).toEqual({ title: "Fix the page" });
		expect(agentTitle(`Fix ${zwj} ${zwnj} page`)).toMatchObject({ error: expect.any(String) });
		const db = { investigation: { updateMany: vi.fn() } };
		await expect(renameThread(db as never, "t1", zwj)).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(db.investigation.updateMany).not.toHaveBeenCalled();
	});
});

describe("agentTitle (#1020)", () => {
	it("takes 3 to 7 words", () => {
		expect(agentTitle("Retry loop in checkout")).toEqual({
			title: "Retry loop in checkout",
		});
		expect(agentTitle("Two words")).toMatchObject({ error: expect.any(String) });
		expect(
			agentTitle("one two three four five six seven eight"),
		).toMatchObject({ error: expect.any(String) });
	});

	it("refuses a title over 80 characters rather than cutting it", () => {
		expect(agentTitle(`${"a".repeat(30)} ${"b".repeat(30)} ${"c".repeat(30)}`)).toMatchObject({
			error: expect.stringContaining("80"),
		});
	});
});

describe("setAgentTitle and renameThread (#1020)", () => {
	const prisma = () => ({
		investigation: {
			updateMany: vi.fn(async () => ({ count: 1 })),
			findUnique: vi.fn(async () => ({ title: "Named by hand" })),
		},
	});

	it("writes the agent's title only while the user has not named the thread, in one update", async () => {
		const db = prisma();
		expect(await setAgentTitle(db as never, "run-1", "Retry loop in checkout")).toEqual({
			title: "Retry loop in checkout",
			kept: false,
		});
		expect(db.investigation.updateMany).toHaveBeenCalledWith({
			where: { id: "run-1", OR: [{ titleSetBy: null }, { titleSetBy: { not: "user" } }] },
			data: { title: "Retry loop in checkout", titleSetBy: "agent" },
		});
	});

	it("leaves a thread the user named, and says what it is called", async () => {
		const db = prisma();
		db.investigation.updateMany.mockResolvedValue({ count: 0 });
		expect(await setAgentTitle(db as never, "run-1", "Retry loop in checkout")).toEqual({
			title: "Named by hand",
			kept: true,
		});
	});

	it("renames as the user, as plain text, and refuses an unknown thread", async () => {
		const db = prisma();
		expect(await renameThread(db as never, "t-1", " Checkout\n retries ")).toEqual({
			id: "t-1",
			title: "Checkout retries",
		});
		expect(db.investigation.updateMany).toHaveBeenCalledWith({
			where: { id: "t-1" },
			data: { title: "Checkout retries", titleSetBy: "user" },
		});
		db.investigation.updateMany.mockResolvedValue({ count: 0 });
		await expect(renameThread(db as never, "nope", "x")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(renameThread(db as never, "t-1", "\u0007\n")).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});
});

describe("instantTitle (#1101)", () => {
	it("takes the first sentence of a multi-sentence brief", () => {
		expect(
			instantTitle("Investigate payment webhook failures. Check database connection pool.", 80),
		).toBe("Investigate payment webhook failures");
	});

	it("takes the first non-empty line of multi-line text", () => {
		expect(
			instantTitle("\n\n  \nInvestigate payment webhook failures\nSecond line details", 80),
		).toBe("Investigate payment webhook failures");
	});

	it("cuts at a word to the max length", () => {
		expect(
			instantTitle("Alpha beta gamma delta epsilon", 16),
		).toBe("Alpha beta gamma");
	});

	it("drops trailing periods", () => {
		expect(
			instantTitle("Investigate payment webhook failures.", 80),
		).toBe("Investigate payment webhook failures");
	});

	it("is never empty for text with words", () => {
		expect(instantTitle("Investigate", 80)).toBe("Investigate");
	});
});

describe("generatedTitle (#1101)", () => {
	it("strips think tags, title prefix, wrapping quotes, and trailing periods", () => {
		expect(
			generatedTitle("<think>\nreasoning about the problem\n</think>\nTitle: \"Fix database connection leak.\"", 80),
		).toBe("Fix database connection leak");
		expect(
			generatedTitle("thread title: “Fix database connection leak”", 80),
		).toBe("Fix database connection leak");
		expect(
			generatedTitle("`Fix database connection leak`", 80),
		).toBe("Fix database connection leak");
	});

	it("takes the first non-empty line", () => {
		expect(
			generatedTitle("\n\n  \nFix database connection leak\nAdditional details line", 80),
		).toBe("Fix database connection leak");
	});

	it("cuts at a word to the max length", () => {
		expect(
			generatedTitle("Alpha beta gamma delta epsilon", 16),
		).toBe("Alpha beta gamma");
	});

	it("returns null for blank output", () => {
		expect(generatedTitle("", 80)).toBeNull();
		expect(generatedTitle("   \n\t  ", 80)).toBeNull();
		expect(generatedTitle("<think>only reasoning</think>", 80)).toBeNull();
	});
});

describe("titlePrompt (#1101)", () => {
	it("carries the max length and task text", () => {
		const prompt = titlePrompt({
			first: "Fix checkout race condition",
			maxLength: 45,
			style: "sentence",
		});
		expect(prompt).toContain("at most 45 characters");
		expect(prompt).toContain("Task:\nFix checkout race condition");
	});

	it("carries the style line for verb-first vs sentence", () => {
		const verbFirst = titlePrompt({
			first: "Fix bug",
			maxLength: 50,
			style: "verb-first",
		});
		expect(verbFirst).toContain('Start with a verb, e.g. "Find why checkout p99 rose".');

		const sentence = titlePrompt({
			first: "Fix bug",
			maxLength: 50,
			style: "sentence",
		});
		expect(sentence).toContain('Use sentence case, e.g. "Checkout p99 latency regression".');
	});

	it("includes the alert line only when alertTitle is given", () => {
		const withAlert = titlePrompt({
			first: "Fix bug",
			alertTitle: "Checkout 500 spike",
			maxLength: 50,
			style: "sentence",
		});
		expect(withAlert).toContain("Alert: Checkout 500 spike");

		const withoutAlert = titlePrompt({
			first: "Fix bug",
			maxLength: 50,
			style: "sentence",
		});
		expect(withoutAlert).not.toContain("Alert:");

		const withNullAlert = titlePrompt({
			first: "Fix bug",
			alertTitle: null,
			maxLength: 50,
			style: "sentence",
		});
		expect(withNullAlert).not.toContain("Alert:");
	});
});

describe("setGeneratedTitle (#1101)", () => {
	it("unforced write needs titleSetBy null and title equal to expected, returning false if rename landed meanwhile", async () => {
		const db = {
			investigation: {
				updateMany: vi.fn(async () => ({ count: 1 })),
			},
		};
		const success = await setGeneratedTitle(db as never, "run-1", "Generated Title", {
			title: "Instant Title",
			force: false,
		});
		expect(success).toBe(true);
		expect(db.investigation.updateMany).toHaveBeenCalledWith({
			where: {
				id: "run-1",
				title: "Instant Title",
				titleSetBy: null,
			},
			data: {
				title: "Generated Title",
				titleSetBy: "agent",
			},
		});

		db.investigation.updateMany.mockResolvedValue({ count: 0 });
		const failed = await setGeneratedTitle(db as never, "run-1", "Generated Title", {
			title: "Instant Title",
			force: false,
		});
		expect(failed).toBe(false);
	});

	it("forced write ignores titleSetBy but still needs the expected title", async () => {
		const db = {
			investigation: {
				updateMany: vi.fn(async () => ({ count: 1 })),
			},
		};
		const success = await setGeneratedTitle(db as never, "run-1", "Forced Title", {
			title: "User Title",
			force: true,
		});
		expect(success).toBe(true);
		expect(db.investigation.updateMany).toHaveBeenCalledWith({
			where: {
				id: "run-1",
				title: "User Title",
			},
			data: {
				title: "Forced Title",
				titleSetBy: "agent",
			},
		});

		db.investigation.updateMany.mockResolvedValue({ count: 0 });
		const failed = await setGeneratedTitle(db as never, "run-1", "Forced Title", {
			title: "Old Title",
			force: true,
		});
		expect(failed).toBe(false);
	});
});
