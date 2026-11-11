// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, SettlePreview } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	disabledWhy,
	type MenuThread,
	settlePreviewLine,
	transcriptText,
} from "./ThreadMenu.js";

const makeThread = (over: Partial<MenuThread> = {}): MenuThread => ({
	id: "t-1",
	title: "Test Thread",
	status: "completed",
	incidentId: null,
	scheduleId: null,
	repositoryId: "repo-1",
	settledAt: null,
	pinnedAt: null,
	archivedAt: null,
	...over,
});

describe("ThreadMenu helpers (#1101 category 20)", () => {
	it("disabledWhy for archive on a running thread ('Stop the run first')", () => {
		const runningThread = makeThread({ status: "running" });
		expect(disabledWhy(runningThread, "archive")).toBe("Stop the run first");
	});

	it("disabledWhy for fork on an incident thread", () => {
		const incidentThread = makeThread({ incidentId: "inc-1" });
		expect(disabledWhy(incidentThread, "fork")).toBe(
			"Incident and scheduled threads fork from their page",
		);
	});

	it("disabledWhy for workIn on a non-project thread", () => {
		const nonProjectThread = makeThread({ repositoryId: null });
		expect(disabledWhy(nonProjectThread, "workIn")).toBe(
			"Only a project thread works in a checkout",
		);
	});

	it("settlePreviewLine({running:0,watches:2,crons:1,wakes:0,children:3,worktrees:[]}) === 'Ends 2 watches, 1 cron and 3 child threads'", () => {
		const preview: SettlePreview = {
			running: 0,
			watches: 2,
			crons: 1,
			wakes: 0,
			children: 3,
			worktrees: [],
		};
		expect(settlePreviewLine(preview)).toBe(
			"Ends 2 watches, 1 cron and 3 child threads",
		);
	});

	it("transcriptText", () => {
		const base = {
			runId: "11111111-1111-4111-8111-111111111111",
			branchId: "main",
			path: [],
			ts: "2026-11-12T12:00:00.000Z",
		};
		const events: CanonicalEvent[] = [
			{
				...base,
				kind: "operator_message",
				text: "Hello agent",
				mode: "queue",
				delivered: true,
				seq: 1,
			},
			{
				...base,
				kind: "agent_step",
				text: "Hello operator! How can I help?",
				toolCalls: [],
				seq: 2,
			},
			{
				...base,
				kind: "error",
				message: "Internal error",
				seq: 3,
			},
			{
				...base,
				kind: "agent_step",
				text: "Here is the plan.",
				toolCalls: [],
				seq: 4,
			},
		];

		const text = transcriptText(events);
		expect(text).toBe(
			"You: Hello agent\n\nAgent: Hello operator! How can I help?\n\nAgent: Here is the plan.",
		);
	});
});
