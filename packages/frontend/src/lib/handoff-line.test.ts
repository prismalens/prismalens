// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ACCESS_LEVEL_LABEL,
	type CanonicalEvent,
	type HandoffPreview,
} from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { formatClock } from "./format-time";
import { handedOff, handoffHint, handoffRecord } from "./handoff-line";

describe("handoff-line helpers", () => {
	it("handoff-L2 load route, continues true and false", () => {
		const preview: HandoffPreview = {
			route: "load",
			harness: "codex",
			carried: "everything",
			omitted: null,
			accessLevel: null,
			preflight: null,
			note: null,
		};

		const resContinues = handoffHint(preview, {
			agent: "Claude",
			continues: true,
			reported: true,
			name: "Run 1",
		});
		expect(resContinues.where).toBe(
			"Continues in Claude's own session and ends in a report on the overview.",
		);
		expect(resContinues.what).toBeNull();
		expect(resContinues.problem).toBeNull();

		const resNotContinues = handoffHint(preview, {
			agent: "Claude",
			continues: false,
			reported: true,
			name: "Run 1",
		});
		expect(resNotContinues.where).toBe("Continues in Claude's own session.");
		expect(resNotContinues.what).toBeNull();
		expect(resNotContinues.problem).toBeNull();
	});

	it("handoff-L2 handoff route, accessLevel auto, reported", () => {
		const preview: HandoffPreview = {
			route: "handoff",
			harness: "codex",
			carried: "the alert, 2 messages and the report",
			omitted: "the other 23 tool calls",
			accessLevel: "auto",
			preflight: null,
			note: null,
		};

		const res = handoffHint(preview, {
			agent: "Codex",
			continues: false,
			reported: true,
			name: "Run 1",
		});
		expect(res.where).toBe(
			`Continues in a fresh Codex session, at ${ACCESS_LEVEL_LABEL.auto}.`,
		);
		expect(res.what).toBe(
			"Codex gets the alert, 2 messages and the report. The other 23 tool calls stay in the transcript file, which Codex can read.",
		);
		expect(res.problem).toBeNull();
	});

	it("handoff-L2 handoff route, not reported, name Run 1, omitted 4 tool calls", () => {
		const preview: HandoffPreview = {
			route: "handoff",
			harness: "codex",
			carried: "the alert and 2 messages",
			omitted: "4 tool calls",
			accessLevel: "auto",
			preflight: null,
			note: null,
		};

		const res = handoffHint(preview, {
			agent: "Codex",
			continues: false,
			reported: false,
			name: "Run 1",
		});
		expect(res.what).toBe(
			"Codex gets the alert and 2 messages. Run 1 has no report; 4 tool calls stay in the transcript file, which Codex can read.",
		);
	});

	it("handoff-L2 preflight refusal with fix formats problem", () => {
		const preview: HandoffPreview = {
			route: "handoff",
			harness: "codex",
			carried: "the alert",
			omitted: null,
			accessLevel: "auto",
			preflight: {
				problem: "Codex is not signed in.",
				fix: "Sign in: codex login.",
			},
			note: null,
		};

		const res = handoffHint(preview, {
			agent: "Codex",
			continues: false,
			reported: true,
			name: "Run 1",
		});
		expect(res.problem).toBe("Codex is not signed in. Sign in: codex login.");
	});

	it("handoff-L2 handoffRecord with model and from, and without both", () => {
		const at = "2026-10-21T14:32:00Z";
		const names = {
			agent: (id: string) => (id === "claude" ? "Claude" : id === "codex" ? "Codex" : id),
			model: (id: string) => (id === "gpt-4" ? "GPT-4" : id),
		};

		const viaFull = {
			harness: "codex",
			model: "gpt-4",
			accessLevel: "auto" as const,
			handoff: {
				from: "claude",
				carried: "the alert and report",
				omitted: null,
			},
		};
		const expectedFull = `Codex, GPT-4, took over from Claude at ${formatClock(at)}, in a fresh session. It got the alert and report.`;
		expect(handoffRecord(viaFull, at, names)).toBe(expectedFull);

		const viaMinimal = {
			harness: "codex",
			model: null,
			accessLevel: null,
			handoff: {
				carried: "the alert and report",
				omitted: null,
			},
		};
		const expectedMinimal = `Codex, took over at ${formatClock(at)}, in a fresh session. It got the alert and report.`;
		expect(handoffRecord(viaMinimal, at, names)).toBe(expectedMinimal);
	});

	it("handoff-L2 handedOff helper verifies via.handoff in operator_message", () => {
		const baseEvent = {
			runId: "run-1",
			branchId: "run",
			path: [],
			seq: 0,
			ts: "2026-10-21T10:00:00Z",
		};

		const eventsWithoutHandoff: CanonicalEvent[] = [
			{
				kind: "error",
				...baseEvent,
				message: "something went wrong",
			},
			{
				kind: "operator_message",
				...baseEvent,
				seq: 1,
				text: "resume",
				mode: "queue",
				delivered: true,
			},
		];
		expect(handedOff(eventsWithoutHandoff)).toBe(false);

		const eventsWithHandoff: CanonicalEvent[] = [
			...eventsWithoutHandoff,
			{
				kind: "operator_message",
				...baseEvent,
				seq: 2,
				text: "continue",
				mode: "queue",
				delivered: true,
				via: {
					harness: "codex",
					model: null,
					accessLevel: null,
					handoff: {
						carried: "alert",
						omitted: null,
					},
				},
			},
		];
		expect(handedOff(eventsWithHandoff)).toBe(true);
	});
});
