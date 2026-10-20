// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isUsageLimitError, usageLimitText } from "./usage-limit.js";

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

	it("leaves every other error alone", () => {
		expect(usageLimitText("Internal error", '{"message":"boom"}')).toBeNull();
	});
});
