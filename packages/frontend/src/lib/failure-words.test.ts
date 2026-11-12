// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { failureWords } from "./failure-words";

describe("failureWords", () => {
	it("names the agent's own sign-in command when its settings give one", () => {
		expect(
			failureWords("unauthorized", "Codex", "`codex login`, or `OPENAI_API_KEY` in env").next,
		).toBe("Run codex login in a terminal, then retry.");
		expect(failureWords("unauthorized", "Codex").next).toBe(
			"Sign in with its own CLI, then retry.",
		);
	});

	it("names a provider overload and says the setup is fine", () => {
		expect(
			failureWords(
				"provider error 529: overloaded_error — upstream model is temporarily overloaded",
			),
		).toEqual({
			what: "The model provider was busy.",
			next: "Nothing is wrong with your setup. Try again in a minute, or pick another model.",
			plain: true,
		});
	});

	it("names a rejected API key and never says signed in", () => {
		const words = failureWords("Invalid API key", "Codex");
		expect(words.what).toBe("Codex's API key was rejected.");
		expect(words.next).toBe("Update the key in the agent's settings, then try again.");
		expect(words.what).not.toContain("signed in");
	});

	it("names out of credit for 402", () => {
		const words = failureWords("API Error: 402 billing_error", "Codex");
		expect(words.what).toBe("Codex is out of credit on its API account.");
		expect(words.next).toBe("Add credit on the provider's billing page, then try again.");
	});

	it("names spend cap for spend limit", () => {
		const words = failureWords("organization spend limit reached");
		expect(words.what).toBe("Your organization's spend cap was reached.");
		expect(words.next).toBe(
			"Raise the cap on the provider's limits page, or switch to another agent.",
		);
	});

	it("names a sign-in problem", () => {
		expect(failureWords("Run failed: not logged in").what).toBe(
			"The agent is not signed in to its model provider.",
		);
	});

	it("falls back to the error's first clause", () => {
		expect(failureWords("disk full; could not write")).toEqual({
			what: "disk full.",
		});
	});

	it("says so when nothing was recorded", () => {
		expect(failureWords(null)).toEqual({ what: "No error was recorded." });
	});
});
