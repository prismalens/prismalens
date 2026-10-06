// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { failureSentence } from "./failure-sentence";

describe("failureSentence", () => {
	it("quotes the agent's words verbatim, without the engine's wrapper", () => {
		expect(
			failureSentence(
				"Claude Code",
				"harness exited early (code=1 signal=null): Not logged in. Run claude /login",
			),
		).toEqual({
			said: 'Claude Code answered "Not logged in. Run claude /login".',
			words: "Not logged in. Run claude /login",
			next: "Sign the agent in, then try again.",
		});
	});

	it("says so when nothing was recorded", () => {
		expect(failureSentence("OpenCode", null)).toEqual({
			said: "No error was recorded.",
			words: null,
		});
	});

	it("keeps the first line and cuts a long one", () => {
		const { words } = failureSentence("OpenCode", `${"x".repeat(300)}\nstack`);
		expect(words?.length).toBe(200);
	});
});
