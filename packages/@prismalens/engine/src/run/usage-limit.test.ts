// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isUsageLimitError, parseReset, usageLimitText } from "./usage-limit.js";

describe("isUsageLimitError", () => {
	it.each([
		"You've hit your session limit · resets 6:10am (Europe/London)",
		"You've reached your weekly limit",
		"You're out of extra usage",
		"Your org is out of usage · add funds to continue",
		"You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro) or try again at 6:10 AM.",
		"Usage limit reached. You’ve reached your usage limit.",
	])("recognises %s", (text) => {
		expect(isUsageLimitError(text)).toBe(true);
	});

	it.each([
		"harness exceeded its wall-clock limit (600000ms) and was killed",
		"Internal error",
		"rate limited, retry",
		"",
	])("does not mistake %s for one", (text) => {
		expect(isUsageLimitError(text)).toBe(false);
	});
});

describe("usageLimitText", () => {
	it("lifts Codex's text out of a generic JSON-RPC error's data", () => {
		const data = JSON.stringify({
			message:
				"You’ve hit your usage limit. Upgrade to Plus to continue using Codex.",
			codexErrorInfo: "usageLimitExceeded",
		});
		expect(usageLimitText("Internal error", data)).toBe(
			"You’ve hit your usage limit. Upgrade to Plus to continue using Codex.",
		);
	});

	it("keeps Claude's own message", () => {
		expect(
			usageLimitText("You've hit your session limit · resets 6:10am", undefined),
		).toBe("You've hit your session limit · resets 6:10am");
	});

	it("falls back to the generic text when the nested message is not valid JSON", () => {
		const data = String.raw`{"message":"bad \q escape","codexErrorInfo":"usageLimitExceeded"}`;
		expect(usageLimitText("Internal error", data)).toBe(
			"Usage limit reached: Internal error",
		);
	});

	it("leaves every other error alone", () => {
		expect(usageLimitText("Internal error", '{"message":"boom"}')).toBeNull();
	});
});

describe("Gemini CLI's quota errors", () => {
	it("a terminal quota is a limit", () => {
		expect(isUsageLimitError("You have exhausted your daily quota on this model.")).toBe(true);
		expect(isUsageLimitError('{"reason":"QUOTA_EXHAUSTED"}')).toBe(true);
	});

	it("a short retry is a rate error the agent retries itself, never a limit", () => {
		expect(isUsageLimitError("Quota exceeded for quota metric. Please retry in 20s.")).toBe(false);
		expect(isUsageLimitError("Quota exceeded for quota metric. Please retry in 4m.")).toBe(false);
	});

	it("a retry of five minutes or more is a limit", () => {
		expect(isUsageLimitError("Quota exceeded for quota metric. Please retry in 3600s.")).toBe(true);
	});

	it("a limit message in any JSON-RPC error's data is lifted out", () => {
		const data = JSON.stringify({ message: "You have exhausted your daily quota on this model." });
		expect(usageLimitText("Internal error", data)).toBe("You have exhausted your daily quota on this model.");
	});
});

describe("parseReset", () => {
	// Local time throughout: the agents word the reset in the user's own zone.
	const now = new Date(2026, 10, 7, 13, 12, 0);

	it("reads Codex's time later the same day", () => {
		expect(parseReset("You've hit your usage limit. Try again at 3:45 PM.", now, "codex")).toEqual(
			new Date(2026, 10, 7, 15, 45, 0),
		);
	});

	it("reads a time already past today as tomorrow", () => {
		expect(parseReset("You've hit your usage limit. try again at 9:05 am.", now, "codex")).toEqual(
			new Date(2026, 10, 8, 9, 5, 0),
		);
	});

	it("reads 12 AM and 12 PM", () => {
		expect(parseReset("try again at 12:00 AM", now)).toEqual(new Date(2026, 10, 8, 0, 0, 0));
		expect(parseReset("try again at 12:30 PM", now)).toEqual(new Date(2026, 10, 8, 12, 30, 0));
	});

	it("reads Codex's dated form across days", () => {
		expect(
			parseReset("You've hit your usage limit. Try again at Nov 9th, 2026 3:45 PM.", now, "codex"),
		).toEqual(new Date(2026, 10, 9, 15, 45, 0));
		expect(parseReset("Try again at Jan 1st, 2027 12:05 AM.", now)).toEqual(new Date(2027, 0, 1, 0, 5, 0));
	});

	it("reads Gemini's retry of five minutes or more", () => {
		expect(parseReset("Please retry in 3600s.", now, "gemini")).toEqual(new Date(now.getTime() + 3_600_000));
		expect(parseReset("Please retry in 10m", now, "gemini")).toEqual(new Date(now.getTime() + 600_000));
	});

	it("names no time for a short retry or for nothing", () => {
		expect(parseReset("Please retry in 20s.", now, "gemini")).toBeNull();
		expect(parseReset("You're out of extra usage", now)).toBeNull();
		expect(parseReset("try again at 13:99 PM", now)).toBeNull();
	});

	it("reads Claude's zoned reset time and unzoned local reset time", () => {
		expect(
			parseReset(
				"You've hit your session limit · resets 6:10am (Europe/London)",
				new Date("2026-11-12T10:00:00Z"),
			),
		).toEqual(new Date("2026-11-13T06:10:00.000Z"));
		expect(
			parseReset(
				"You've hit your session limit · resets 6:10am (Europe/London)",
				new Date("2026-07-01T10:00:00Z"),
			),
		).toEqual(new Date("2026-07-02T05:10:00.000Z"));

		const before6pm = new Date(2026, 10, 7, 13, 12, 0);
		expect(parseReset("resets 6pm", before6pm)).toEqual(
			new Date(2026, 10, 7, 18, 0, 0, 0),
		);
		const after6pm = new Date(2026, 10, 7, 19, 0, 0);
		expect(parseReset("resets 6pm", after6pm)).toEqual(
			new Date(2026, 10, 8, 18, 0, 0, 0),
		);
	});
});
