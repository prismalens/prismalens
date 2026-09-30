// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { deriveTranscript, pinnedTo } from "@/lib/investigation-events";
import { Transcript } from "./Transcript";
import { followUpState, mergeRunEvents } from "./useInvestigationRun";

const runId = "11111111-1111-4111-8111-111111111111";
const at = "2026-09-30T10:00:00.000Z";
const step = (seq: number, text: string): CanonicalEvent => ({
	kind: "agent_step",
	runId,
	branchId: "run",
	path: [],
	seq,
	ts: at,
	text,
	toolCalls: [],
});
const followUp = (seq: number, resumed: { name: string; head: string }[]): CanonicalEvent => ({
	kind: "operator_message",
	runId,
	branchId: "run",
	path: [],
	seq,
	ts: at,
	text: "Why the pool?",
	mode: "queue",
	delivered: true,
	resumed,
});

describe("mergeRunEvents (#747)", () => {
	it("keeps the stored history and appends a follow-up's live events once each", () => {
		const history = [step(0, "first"), step(1, "second")];
		const live = [step(1, "second"), followUp(2, []), step(3, "answer")];
		expect(mergeRunEvents(history, live).map((e) => e.seq)).toEqual([0, 1, 2, 3]);
	});
});

describe("followUpState (#747)", () => {
	it("is never resumable while the run is live", () => {
		expect(followUpState({ status: "running", resumable: true })).toEqual({
			resumable: false,
			resumeBlockedReason: null,
		});
		expect(followUpState({ status: "completed", resumable: true }).resumable).toBe(true);
		expect(
			followUpState({
				status: "failed",
				resumable: false,
				resumeBlockedReason: "deepagents can't reopen a finished session, so a new run starts from the report.",
			}).resumeBlockedReason,
		).toMatch(/^deepagents can't reopen/);
	});
});

describe("the follow-up divider (#747)", () => {
	it("names every repo with its short commit, or just the commit for one", () => {
		expect(
			pinnedTo({
				repos: [
					{ name: "api", head: "1a2b3c4d5e6f" },
					{ name: "worker", head: "5d6e7f8a9b0c" },
				],
			}),
		).toBe("api@1a2b3c4, worker@5d6e7f8");
		expect(pinnedTo({ repos: [{ name: "repo", head: "1a2b3c4d5e6f" }] })).toBe("1a2b3c4");
	});

	it("renders a divider before the follow-up's first message", () => {
		const items = deriveTranscript(
			[step(0, "The pool is exhausted."), followUp(1, [{ name: "repo", head: "1a2b3c4d5e6f" }])],
			Date.parse(at),
		);
		expect(items.map((i) => i.kind)).toEqual(["prose", "divider", "operator"]);
		const html = renderToStaticMarkup(createElement(Transcript, { items, incidentId: "inc-1" }));
		expect(html).toContain('data-testid="transcript-divider"');
		expect(html).toContain("Resumed in the same session, code at 1a2b3c4");
	});
});
