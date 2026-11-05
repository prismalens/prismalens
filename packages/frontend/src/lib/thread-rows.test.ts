// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	announcements,
	rowLine,
	rowState,
	sectionsOf,
	severityColor,
	threadLink,
} from "./thread-rows";

const row = (over: Partial<ThreadRow> = {}): ThreadRow =>
	({
		id: "t1",
		incidentId: null,
		scheduleId: null,
		status: "completed",
		kind: "chat",
		title: "Retry logic cleanup",
		error: null,
		rootCause: null,
		awaitingApprovalAt: null,
		unseen: false,
		latestText: null,
		section: "active",
		projectName: "acme/shop",
		serviceName: null,
		...over,
	}) as ThreadRow;

const unit = (t: ThreadRow): ThreadUnit => ({
	section: t.section,
	incident: null,
	threads: [t],
});

describe("thread rows (#1020)", () => {
	it("shows one state: an ask over live, an unseen failure, a new outcome", () => {
		expect(
			rowState(row({ status: "running", awaitingApprovalAt: "2026-11-03" })),
		).toBe("ask");
		expect(rowState(row({ status: "running" }))).toBe("live");
		expect(rowState(row({ status: "failed", unseen: true }))).toBe("failed");
		expect(rowState(row({ unseen: true }))).toBe("new");
		expect(rowState(row())).toBeNull();
	});

	it("says what is happening, the outcome, or why it failed", () => {
		expect(
			rowLine(row({ status: "running", latestText: "editing retry.ts" })),
		).toBe("editing retry.ts");
		expect(rowLine(row({ status: "failed", error: "usage limit" }))).toBe(
			"usage limit",
		);
		expect(rowLine(row({ status: "failed" }))).toBe("Run failed");
		expect(rowLine(row({ status: "cancelled" }))).toBe("Stopped by you");
		expect(
			rowLine(
				row({ kind: "investigation", incidentId: "i1", rootCause: "bad deploy" }),
			),
		).toBe("Likely cause: bad deploy");
		expect(rowLine(row({ kind: "investigation", incidentId: "i1" }))).toBe(
			"No cause named",
		);
		expect(rowLine(row({ latestText: "yes" }))).toBe("Answer: yes");
		expect(rowLine(row())).toBeNull();
	});

	it("links each subject to its own page", () => {
		expect(threadLink(row({ incidentId: "i1" }))).toEqual({
			to: "/incidents/$id/conversation",
			params: { id: "i1" },
			search: { investigation: "t1" },
		});
		expect(threadLink(row({ scheduleId: "s1" }))).toEqual({
			to: "/schedules/$id/runs/$runId",
			params: { id: "s1", runId: "t1" },
		});
		expect(threadLink(row())).toEqual({
			to: "/threads/$id",
			params: { id: "t1" },
		});
	});

	it("tones by severity, quiet when unknown", () => {
		expect(severityColor("critical")).toBe("var(--danger)");
		expect(severityColor("nope")).toBe("var(--text-3)");
	});

	it("announces moves into Needs you or Settled, never a first sighting", () => {
		const before = sectionsOf([unit(row())]);
		expect(
			announcements(before, [
				unit(row({ section: "needs", status: "running", awaitingApprovalAt: "x" })),
			]),
		).toEqual(["Retry logic cleanup: waiting for you"]);
		expect(
			announcements(before, [unit(row({ section: "needs", unseen: true }))]),
		).toEqual(["Retry logic cleanup: needs you"]);
		expect(announcements(before, [unit(row({ section: "settled" }))])).toEqual([
			"Retry logic cleanup: settled",
		]);
		expect(
			announcements(new Map(), [unit(row({ section: "needs" }))]),
		).toEqual([]);
	});
});
