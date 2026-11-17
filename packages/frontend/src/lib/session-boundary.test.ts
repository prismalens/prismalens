// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, SessionOpening } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { itemEventKey } from "@/components/investigation/WindowedTranscript";
import { deriveTranscript } from "./investigation-events";
import { sessionLine } from "./session-boundary";

const names = {
	agent: (id: string) => ({ "claude-code": "Claude Code", opencode: "OpenCode" })[id] ?? id,
	model: (id: string) => ({ opus: "Opus 5.5", sonnet: "Sonnet 5.5" })[id] ?? id,
};
const open = (o: Partial<SessionOpening>): SessionOpening => ({
	how: "new",
	cause: "first",
	harness: "claude-code",
	model: "opus",
	...o,
});

describe("sessionLine (#1166)", () => {
	it("says how each session continued, with its cause", () => {
		expect(sessionLine(open({}), names)).toBe("New session · Claude Code · Opus 5.5 · started");
		expect(sessionLine(open({ how: "resume", cause: "follow_up" }), names)).toBe(
			"Same session · Claude Code · Opus 5.5 · resumed",
		);
		expect(
			sessionLine(open({ how: "load", cause: "limit", replayed: 2, replay: "dedupe" }), names, "1a2b3c4"),
		).toBe(
			"Same session · Claude Code · Opus 5.5 · reloaded, 2 earlier updates replayed and dropped, code at 1a2b3c4 · after the usage limit reset",
		);
		expect(sessionLine(open({ how: "load", replayed: 0, modelFrom: "sonnet", cause: "wake" }), names)).toBe(
			"Same session · Claude Code · Opus 5.5 · reloaded · switched from Sonnet 5.5; a new model may not reuse the cached context · woken by a scheduled wake",
		);
		expect(
			sessionLine(open({ how: "handoff", harness: "opencode", model: null, from: "claude-code", carried: "the report" }), names),
		).toBe("New session · OpenCode · handed off from Claude Code. It got the report.");
		expect(sessionLine(open({ how: "summary", cause: "compact" }), names)).toBe(
			"New session · Claude Code · Opus 5.5 · started fresh with a summary · to compact",
		);
		expect(sessionLine(open({ how: "load_broken", carried: "1 message", cause: "idle_compact" }), names)).toBe(
			"New session · Claude Code · Opus 5.5 · Claude Code can't reload a session reliably, so the conversation was carried over. It got 1 message. · to compact",
		);
	});
});

describe("session divider keys (#1166)", () => {
	const base = (seq: number) => ({
		runId: "00000000-0000-4000-8000-000000000001",
		branchId: "run",
		path: [],
		seq,
		label: null,
		ts: "2026-11-17T10:00:00.000Z",
	});
	it("map back to their event, whether the opening's own event or its message draws the divider", () => {
		const events = [
			{ kind: "session_opened", ...base(3), ...open({ cause: "compact" }), carrier: "event" },
			{ kind: "session_opened", ...base(7), ...open({ how: "load", cause: "follow_up" }), carrier: "message" },
			{
				kind: "operator_message",
				...base(8),
				text: "Why?",
				mode: "queue",
				delivered: true,
				via: { harness: "claude-code", model: "opus", accessLevel: null, session: open({ how: "load", cause: "follow_up" }) },
			},
		] as CanonicalEvent[];
		const dividers = deriveTranscript(events).filter((i) => i.kind === "divider");
		expect(dividers.map((d) => d.key)).toEqual(["run-3", "session-run-8"]);
		expect(dividers.map((d) => itemEventKey(d.key))).toEqual(["run:3", "run:8"]);
	});
});
