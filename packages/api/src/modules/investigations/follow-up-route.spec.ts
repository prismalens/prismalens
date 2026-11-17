// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	followUpRoute,
	handoffPreflight,
	inheritedLevel,
} from "./follow-up-route.js";

describe("followUpRoute: saved session -> load; else handoff", () => {
	it("loads the run's own session when the chips keep its agent", () => {
		expect(
			followUpRoute({ harness: "opencode", acpSessionId: "ses_1" }),
		).toEqual({ route: "load", harness: "opencode" });
		expect(
			followUpRoute({ harness: "opencode", acpSessionId: "ses_1" }, "opencode"),
		).toEqual({ route: "load", harness: "opencode" });
	});

	it("hands off when the session is gone or another agent is chosen", () => {
		expect(followUpRoute({ harness: "opencode", acpSessionId: null })).toEqual({
			route: "handoff",
			harness: "opencode",
		});
		expect(
			followUpRoute({ harness: "opencode", acpSessionId: "ses_1" }, "codex"),
		).toEqual({ route: "handoff", harness: "codex" });
	});

	it("has nowhere to go when the run names no agent and none is chosen", () => {
		expect(followUpRoute({ harness: null, acpSessionId: null })).toBeNull();
	});
});

describe("followUpRoute returning to an agent's own session (#1168)", () => {
	const sessions = JSON.stringify({
		opencode: { acpSessionId: "ses_open", seenSeq: 10, receipts: 2, checkpoint: "chk", model: "m_open", effort: null },
		codex: { acpSessionId: "ses_codex", seenSeq: 5, receipts: 1, checkpoint: "chk", model: null, effort: null },
	});
	const inv = { harness: "claude-code", acpSessionId: "ses_claude", agentSessions: sessions };

	it("returning to an agent with an entry and a numeric seenSeq gives return", () => {
		expect(followUpRoute(inv, "opencode")).toEqual({ route: "return", harness: "opencode" });
	});

	it("NO_RETURN covers codex: Codex with an entry still gets handoff", () => {
		expect(followUpRoute(inv, "codex")).toEqual({
			route: "handoff",
			harness: "codex",
			noReturn: "autonomous",
		});
	});

	it("an entry with noReturn: true gives handoff", () => {
		const withNoReturn = JSON.stringify({
			opencode: { acpSessionId: "ses_open", seenSeq: 10, receipts: 2, checkpoint: "chk", model: null, effort: null, noReturn: true },
		});
		expect(followUpRoute({ ...inv, agentSessions: withNoReturn }, "opencode")).toEqual({
			route: "handoff",
			harness: "opencode",
			noReturn: "autonomous",
		});
	});

	it("explicit model: null while the entry ran a named model gives handoff; model undefined keeps return", () => {
		expect(followUpRoute(inv, "opencode", { model: null })).toEqual({
			route: "handoff",
			harness: "opencode",
			noReturn: "default",
		});
		expect(followUpRoute(inv, "opencode", { model: undefined })).toEqual({
			route: "return",
			harness: "opencode",
		});
	});

	it("no entry (a thread from before the column) gives today's handoff", () => {
		expect(
			followUpRoute(
				{ harness: "claude-code", acpSessionId: "ses_claude", agentSessions: null },
				"opencode",
			),
		).toEqual({
			route: "handoff",
			harness: "opencode",
		});
	});
});

describe("handoffPreflight: a failure names the fix", () => {
	it("an agent that is not installed: install it, or pick another", () => {
		expect(
			handoffPreflight(
				"codex",
				{
					runnable: false,
					failure: "pinned-harness-missing",
					reason: "Codex is not on this machine. Install: npm i -g @openai/codex",
					harness: "codex",
				},
				null,
			),
		).toEqual({
			problem: "Codex is not on this machine. Install: npm i -g @openai/codex",
			fix: expect.stringMatching(/^Install it \(.+\), or pick another agent\.$/),
		});
	});

	it("a model the agent cannot take: pick another model", () => {
		expect(
			handoffPreflight(
				"gemini",
				{
					runnable: false,
					failure: "model-unsupported",
					reason: "Gemini CLI cannot take a model.",
				},
				null,
			)?.fix,
		).toBe("Pick another model on the model chip.");
	});

	it("an agent whose last check asked for a sign-in: how to sign in", () => {
		expect(
			handoffPreflight(
				"claude-code",
				{ runnable: true, harness: "claude-code", auto: false },
				"sign-in-needed",
			),
		).toEqual({
			problem: "Claude Code is not signed in.",
			fix: "Sign in: `claude /login`, or `ANTHROPIC_API_KEY` in env.",
		});
	});

	it("passes a runnable, signed-in agent", () => {
		expect(
			handoffPreflight(
				"codex",
				{ runnable: true, harness: "codex", auto: false },
				"answers-acp",
			),
		).toBeNull();
	});
});

describe("inheritedLevel: permission is inherited, never broadened", () => {
	it.each([
		"supervised",
		"auto-edits",
		"auto",
		"full-access",
	] as const)("keeps %s as it was", (level) => {
		expect(inheritedLevel(level)).toBe(level);
	});

	it("gives a run from before levels the narrowest, never a default", () => {
		expect(inheritedLevel(undefined)).toBe("supervised");
	});
});
