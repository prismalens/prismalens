// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { failureWords } from "./failure-words";

describe("failureWords", () => {
	it("names the agent's own sign-in command when its settings give one", () => {
		expect(
			failureWords("401 unauthorized", "Codex", "`codex login`, or `OPENAI_API_KEY` in env").next,
		).toBe("Run codex login in a terminal, then retry.");
		expect(failureWords("401 unauthorized", "Codex").next).toBe(
			"Sign in with its own CLI, then retry.",
		);
	});

	it("names a provider overload and says the setup is fine", () => {
		expect(
			failureWords(
				"provider error 529: overloaded_error — upstream model is temporarily overloaded",
			),
		).toEqual({
			what: "The model provider was overloaded.",
			next: "Nothing is wrong with your setup. Try again in a minute.",
		});
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
