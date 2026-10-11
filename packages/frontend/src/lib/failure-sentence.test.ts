// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { failureSentence } from "./failure-sentence";

describe("failureSentence", () => {
	it("quotes the agent's words verbatim, without the engine's wrapper", () => {
		expect(
			failureSentence(
				"Claude Code",
				"harness exited early (code=1 signal=null): permission denied on /tmp/x",
			),
		).toMatchObject({
			said: 'Claude Code answered "permission denied on /tmp/x".',
			words: "permission denied on /tmp/x",
		});
	});

	it("says a signed-out agent plainly and names it (#673 w5-39)", () => {
		expect(
			failureSentence(
				"Claude Code",
				"harness exited early (code=1 signal=null): Not logged in. Run claude /login",
			),
		).toEqual({
			said: "Claude Code is not signed in to its model provider.",
			words: null,
			next: "Sign in to Claude Code, then try again.",
			detail: "Not logged in. Run claude /login",
		});
		expect(
			failureSentence(
				"Claude Code",
				"Internal error: Failed to authenticate: OAuth session expired and could not be refreshed",
			),
		).toMatchObject({
			said: "Claude Code's sign-in has expired.",
			words: null,
			next: "Sign in to Claude Code again, then start a new run.",
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

	it("formats validation retry failure as PrismaLens finding without agent attribution (#673 w34)", () => {
		const rawError =
			"report did not validate after one retry (no-json-block: no fenced ```json block ...)";
		expect(failureSentence("Claude Code", rawError)).toEqual({
			said: "The agent's report could not be read.",
			words: null,
			next: "Try again, or pick another model.",
			detail: rawError,
		});
	});

	it("formats produced no evidence failure as PrismaLens finding (#673 w34)", () => {
		const rawError = "investigation produced no evidence: no tool ran";
		const result = failureSentence("OpenCode", rawError);
		expect(result.said).toMatch(/^The agent finished without running/);
		expect(result.words).toBeNull();
		expect(result.next).toBe("Try again, or pick another model.");
		expect(result.detail).toBe(rawError);
	});
});
