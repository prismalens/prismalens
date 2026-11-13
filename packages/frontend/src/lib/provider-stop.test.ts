// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	accountPage,
	stopLine,
	stopMarkName,
	stopNext,
	stopNodeLine,
	stopRowWords,
	type ThreadStop,
} from "./provider-stop";

const clock = (at: string) => at.slice(11, 16);
const fixedNow = Date.parse("2026-11-11T15:00:00.000Z");

describe("stopLine", () => {
	it("usage limit resuming", () => {
		const limit: ThreadStop = {
			mode: "usage_limit",
			autoResume: true,
			resetsAt: "2026-11-11T15:45:00.000Z",
			nextAttemptAt: "2026-11-11T15:47:00.000Z",
			attempts: 1,
			since: "2026-11-11T15:00:00.000Z",
		};
		expect(stopLine(limit, { clock, now: fixedNow })).toBe(
			"Usage limit reached · resumes 15:47",
		);
	});

	it("weekly window", () => {
		const limit: ThreadStop = {
			mode: "usage_limit",
			window: "weekly",
			autoResume: true,
			resetsAt: "2026-11-11T15:45:00.000Z",
			nextAttemptAt: "2026-11-11T15:47:00.000Z",
			attempts: 1,
			since: "2026-11-11T15:00:00.000Z",
		};
		expect(stopLine(limit, { clock, now: fixedNow })).toBe(
			"Weekly limit reached · resumes 15:47",
		);
	});

	it("unknown reset retrying", () => {
		const limit: ThreadStop = {
			mode: "usage_limit",
			autoResume: true,
			resetsAt: null,
			nextAttemptAt: "2026-11-11T16:00:00.000Z",
			attempts: 1,
			maxAttempts: 6,
			since: "2026-11-11T15:00:00.000Z",
		};
		expect(stopLine(limit, { clock, now: fixedNow })).toBe(
			"Usage limit reached · reset time unknown, trying again at 16:00 (try 2 of 7)",
		);
	});

	it("gave up", () => {
		const limit: ThreadStop = {
			mode: "usage_limit",
			gaveUp: true,
			autoResume: true,
			resetsAt: null,
			attempts: 7,
			maxAttempts: 6,
			since: "2026-11-11T15:00:00.000Z",
		};
		expect(stopLine(limit, { clock, now: fixedNow })).toBe(
			"Usage limit reached · stopped trying after 6 tries",
		);
	});

	it("rate_limited trying again", () => {
		const limit: ThreadStop = {
			mode: "rate_limited",
			autoResume: true,
			resetsAt: null,
			nextAttemptAt: "2026-11-11T15:45:00.000Z",
			attempts: 2,
			maxAttempts: 5,
			since: "2026-11-11T15:00:00.000Z",
		};
		expect(stopLine(limit, { clock, now: fixedNow })).toBe(
			"Rate limited · trying again at 15:45 (try 2 of 5)",
		);
	});

	it("rate_limited gave up", () => {
		const limit: ThreadStop = {
			mode: "rate_limited",
			gaveUp: true,
			autoResume: true,
			resetsAt: null,
			attempts: 6,
			since: "2026-11-11T15:00:00.000Z",
		};
		expect(stopLine(limit, { clock, now: fixedNow })).toBe(
			"Rate limited · stopped after 5 tries",
		);
	});

	it("overloaded retrying in 30 s", () => {
		const limit: ThreadStop = {
			mode: "overloaded",
			autoResume: true,
			resetsAt: null,
			nextAttemptAt: "2026-11-11T15:00:30.000Z",
			attempts: 2,
			maxAttempts: 5,
			since: "2026-11-11T15:00:00.000Z",
		};
		expect(stopLine(limit, { clock, now: fixedNow })).toBe(
			"Provider busy · retrying in 30 s (try 2 of 5)",
		);
	});

	it("out_of_credit", () => {
		const limit: ThreadStop = {
			mode: "out_of_credit",
			agent: "Codex",
			autoResume: false,
			resetsAt: null,
			attempts: 1,
			since: "2026-11-11T15:00:00.000Z",
		};
		expect(stopLine(limit, { clock, now: fixedNow })).toBe(
			"Codex is out of credit on its API account",
		);
	});

	it("key_rejected", () => {
		const limit: ThreadStop = {
			mode: "key_rejected",
			agent: "Codex",
			autoResume: false,
			resetsAt: null,
			attempts: 1,
			since: "2026-11-11T15:00:00.000Z",
		};
		expect(stopLine(limit, { clock, now: fixedNow })).toBe(
			"Codex's API key was rejected",
		);
	});

	it("spend_cap", () => {
		const limit: ThreadStop = {
			mode: "spend_cap",
			autoResume: false,
			resetsAt: null,
			attempts: 1,
			since: "2026-11-11T15:00:00.000Z",
		};
		expect(stopLine(limit, { clock, now: fixedNow })).toBe(
			"Your organization's spend cap was reached",
		);
	});
});

describe("no Blocked line or stopNext line contains resume or sign in", () => {
	const blockedModes = ["out_of_credit", "key_rejected", "spend_cap"] as const;

	it.each(blockedModes)("mode %s contains neither resume nor sign in", (mode) => {
		const limit: ThreadStop = {
			mode,
			agent: "Codex",
			autoResume: false,
			resetsAt: null,
			attempts: 1,
			since: "2026-11-11T15:00:00.000Z",
		};
		const line = stopLine(limit, { clock, now: fixedNow });
		const next = stopNext(limit);

		expect(line.toLowerCase()).not.toContain("resume");
		expect(line.toLowerCase()).not.toContain("sign in");
		expect(next.toLowerCase()).not.toContain("resume");
		expect(next.toLowerCase()).not.toContain("sign in");
	});

	it.each([
		[
			"out_of_credit",
			"Nothing happens by itself. Add credit, then Try again. Your draft is kept.",
		],
		[
			"key_rejected",
			"Nothing happens by itself. Update the key in the agent's settings, then Try again. Your draft is kept.",
		],
		[
			"spend_cap",
			"Nothing happens by itself. Raise the cap, then Try again. Your draft is kept.",
		],
	] as const)("mode %s tells its own repair: %s", (mode, expected) => {
		expect(
			stopNext({
				mode,
				autoResume: false,
				resetsAt: null,
				attempts: 1,
				since: "2026-11-11T15:00:00.000Z",
			}),
		).toBe(expected);
	});
});

// a04d92755 names the stop once on its strip, so a row's detail is only its one time.
describe("stopRowWords", () => {
	it("out_of_credit", () => {
		expect(stopRowWords({ mode: "out_of_credit", resetsAt: null })).toEqual({
			state: "blocked",
			word: "Blocked",
			detail: "Out of credit",
		});
	});

	it("key_rejected", () => {
		expect(stopRowWords({ mode: "key_rejected", resetsAt: null })).toEqual({
			state: "blocked",
			word: "Blocked",
			detail: "API key rejected",
		});
	});

	it("spend_cap", () => {
		expect(stopRowWords({ mode: "spend_cap", resetsAt: null })).toEqual({
			state: "blocked",
			word: "Blocked",
			detail: "Spend cap reached",
		});
	});

	it("rate_limited", () => {
		expect(
			stopRowWords(
				{
					mode: "rate_limited",
					resetsAt: null,
					nextAttemptAt: "2026-11-11T15:45:00.000Z",
					nextTry: { n: 2, of: 5 },
				},
				clock,
			),
		).toEqual({
			state: "limited",
			word: "Limited",
			detail: "Next try 15:45 (2 of 5)",
		});
	});

	it("overloaded", () => {
		expect(
			stopRowWords(
				{
					mode: "overloaded",
					resetsAt: null,
					nextAttemptAt: "2026-11-11T15:45:00.000Z",
				},
				clock,
			),
		).toEqual({
			state: "limited",
			word: "Limited",
			detail: "Next try 15:45",
		});
	});

	it("usage_limit", () => {
		expect(
			stopRowWords(
				{
					mode: "usage_limit",
					resetsAt: "2026-11-11T15:45:00.000Z",
				},
				clock,
			),
		).toEqual({
			state: "limited",
			word: "Limited",
			detail: "Resumes 15:45",
		});
	});
});

describe("stopMarkName", () => {
	it("usage_limit with resetsAt", () => {
		const ev = {
			kind: "usage_limit",
			resetsAt: "2026-11-11T18:30:00.000Z",
		} as CanonicalEvent;
		expect(stopMarkName(ev, clock)).toBe("Usage limit, resets 18:30");
	});

	it("usage_limit with no resetsAt", () => {
		const ev = {
			kind: "usage_limit",
			resetsAt: null,
		} as CanonicalEvent;
		expect(stopMarkName(ev, clock)).toBe("Usage limit, reset unknown");
	});

	it("usage_limit rate_limited mode", () => {
		const ev = {
			kind: "usage_limit",
			mode: "rate_limited",
		} as CanonicalEvent;
		expect(stopMarkName(ev, clock)).toBe("Rate limited");
	});

	it("usage_limit overloaded mode", () => {
		const ev = {
			kind: "usage_limit",
			mode: "overloaded",
		} as CanonicalEvent;
		expect(stopMarkName(ev, clock)).toBe("Provider busy");
	});

	it("provider_blocked modes", () => {
		expect(
			stopMarkName({
				kind: "provider_blocked",
				mode: "out_of_credit",
			} as CanonicalEvent),
		).toBe("Out of credit");
		expect(
			stopMarkName({
				kind: "provider_blocked",
				mode: "key_rejected",
			} as CanonicalEvent),
		).toBe("API key rejected");
		expect(
			stopMarkName({
				kind: "provider_blocked",
				mode: "spend_cap",
			} as CanonicalEvent),
		).toBe("Spend cap reached");
	});

	it("provider_retry", () => {
		const ev = {
			kind: "provider_retry",
			mode: "rate_limited",
			attempt: 2,
			maxAttempts: 5,
			at: "2026-11-11T15:45:00.000Z",
		} as CanonicalEvent;
		expect(stopMarkName(ev, clock)).toBe("Rate limited, try 2 of 5 at 15:45");
	});

	it("run_interrupted", () => {
		const ev = { kind: "run_interrupted" } as CanonicalEvent;
		expect(stopMarkName(ev, clock)).toBe("Interrupted by restart");
	});

	it("resumed for limit_reset", () => {
		const ev = { kind: "resumed", reason: "limit_reset" } as CanonicalEvent;
		expect(stopMarkName(ev, clock)).toBe("Resumed after the stop");
	});

	it("null for agent_step", () => {
		const ev = { kind: "agent_step" } as CanonicalEvent;
		expect(stopMarkName(ev, clock)).toBeNull();
	});
});

describe("stopNodeLine", () => {
	it("usage_limit is the turn's one plain line, with its retry time when the reset is known (sheet §10)", () => {
		expect(
			stopNodeLine(
				{
					kind: "usage_limit",
					agent: "Codex",
					mode: "usage_limit",
					resetsAt: "2026-11-11T15:45:00.000Z",
				} as CanonicalEvent,
				clock,
			),
		).toBe("Usage limit reached. Retry after 15:45");

		expect(
			stopNodeLine(
				{
					kind: "usage_limit",
					agent: "Codex",
					mode: "usage_limit",
					resetsAt: null,
				} as CanonicalEvent,
				clock,
			),
		).toBe("Usage limit reached");

		expect(
			stopNodeLine(
				{
					kind: "usage_limit",
					agent: "Codex",
					window: "weekly",
					resetsAt: null,
				} as CanonicalEvent,
				clock,
			),
		).toBe("Usage limit reached");
	});

	it("usage_limit rate_limited and overloaded modes", () => {
		expect(
			stopNodeLine(
				{
					kind: "usage_limit",
					agent: "Codex",
					mode: "rate_limited",
				} as CanonicalEvent,
				clock,
			),
		).toBe("Codex's provider limited the request rate");

		expect(
			stopNodeLine(
				{
					kind: "usage_limit",
					agent: "Codex",
					mode: "overloaded",
				} as CanonicalEvent,
				clock,
			),
		).toBe("Codex's provider was busy");
	});

	it("provider_blocked for each mode", () => {
		expect(
			stopNodeLine(
				{
					kind: "provider_blocked",
					agent: "Codex",
					mode: "out_of_credit",
				} as CanonicalEvent,
				clock,
			),
		).toBe("Codex is out of credit on its API account");

		expect(
			stopNodeLine(
				{
					kind: "provider_blocked",
					agent: "Codex",
					mode: "key_rejected",
				} as CanonicalEvent,
				clock,
			),
		).toBe("Codex's API key was rejected");

		expect(
			stopNodeLine(
				{
					kind: "provider_blocked",
					agent: "Codex",
					mode: "spend_cap",
				} as CanonicalEvent,
				clock,
			),
		).toBe("Your organization's spend cap was reached");
	});

	it("provider_retry format", () => {
		expect(
			stopNodeLine(
				{
					kind: "provider_retry",
					mode: "rate_limited",
					attempt: 2,
					maxAttempts: 5,
					at: "2026-11-11T15:45:00.000Z",
				} as CanonicalEvent,
				clock,
			),
		).toBe("Retry 2/5 · Rate limited · next 15:45");
	});

	it("resume_scheduled gave up and with maxAttempts", () => {
		expect(
			stopNodeLine(
				{
					kind: "resume_scheduled",
					gaveUp: true,
				} as CanonicalEvent,
				clock,
			),
		).toBe("Stopped trying to resume");

		expect(
			stopNodeLine(
				{
					kind: "resume_scheduled",
					attempt: 2,
					maxAttempts: 5,
					at: "2026-11-11T15:45:00.000Z",
				} as CanonicalEvent,
				clock,
			),
		).toBe("Next try 15:45 (try 2 of 5)");
		// A usage limit with no reset counts its retries, so the try comes from nextTry.
		expect(
			stopNodeLine(
				{
					kind: "resume_scheduled",
					attempt: 1,
					maxAttempts: 7,
					nextTry: { n: 2, of: 7 },
					at: "2026-11-11T08:37:00.000Z",
				} as CanonicalEvent,
				clock,
			),
		).toBe("Next try 08:37 (try 2 of 7)");
	});

	it("resumed and run_interrupted", () => {
		expect(
			stopNodeLine(
				{
					kind: "resumed",
					reason: "limit_reset",
				} as CanonicalEvent,
				clock,
			),
		).toBe("Resumed where it stopped");

		expect(
			stopNodeLine(
				{
					kind: "run_interrupted",
				} as CanonicalEvent,
				clock,
			),
		).toBe("Interrupted by restart");
	});

	it("returns null for agent_step", () => {
		expect(
			stopNodeLine(
				{
					kind: "agent_step",
				} as CanonicalEvent,
				clock,
			),
		).toBeNull();
	});
});

describe("accountPage (#1101 F4)", () => {
	it("an agent with its own provider gets that provider's page", () => {
		expect(accountPage("codex", "limits")).toBe(
			"https://platform.openai.com/settings/organization/limits",
		);
	});

	it("a provider-agnostic agent gets the page of its model's provider", () => {
		expect(accountPage("opencode", "billing", "anthropic/claude-sonnet-5-5")).toBe(
			"https://platform.claude.com/settings/billing",
		);
	});

	it("is null when the model's provider has no known page", () => {
		expect(accountPage("opencode", "billing", "deepseek/v4.1-flash")).toBeNull();
	});
});
