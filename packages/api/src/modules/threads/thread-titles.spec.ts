// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import {
	agentTitle,
	plainTitle,
	renameThread,
	setAgentTitle,
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

	it("drops markdown marks, so a title never shows literal asterisks or ticks (#1101 bar 1.6)", () => {
		expect(plainTitle("Looking at **recent commits** first")).toBe(
			"Looking at recent commits first",
		);
		expect(plainTitle("Retry `pnpm test` in [api](https://x.test)")).toBe(
			"Retry pnpm test in api",
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
