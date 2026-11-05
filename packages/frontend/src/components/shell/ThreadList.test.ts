// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations, Schedule } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { needOf } from "@/components/inbox/inbox-model";
import { isPlainChat, triggerOf } from "@/lib/trigger";
import { incidentRow,
	ORIGIN_WORD,
	STATE_WORD, scheduleRow, sortRows } from "./ThreadList";

const at = (m: number) => new Date(Date.UTC(2026, 10, 4, 12, m)).toISOString();
type Run = NonNullable<IncidentWithRelations["investigations"]>[number];
type Alert = NonNullable<IncidentWithRelations["alerts"]>[number];

const run = (p: Partial<Run>) =>
	({
		id: crypto.randomUUID(),
		status: "completed",
		kind: "investigation",
		rootCause: null,
		createdAt: at(1),
		completedAt: at(2),
		...p,
	}) as Run;
const alert = (source: string) =>
	({ id: "a", status: "triggered", source, triggeredAt: at(0) }) as Alert;
const incident = (p: Partial<IncidentWithRelations>) =>
	({
		id: crypto.randomUUID(),
		number: 1,
		title: "Checkout slow",
		status: "investigating",
		severity: "high",
		triggeredAt: at(0),
		alertCount: 0,
		alerts: [],
		investigations: [],
		...p,
	}) as IncidentWithRelations;

describe("triggerOf", () => {
	it("reads a thread with no alert as started by you", () => {
		expect(triggerOf(incident({})).kind).toBe("you");
	});
	it("reads a monitoring source as an alert", () => {
		expect(
			triggerOf(incident({ alertCount: 1, alerts: [alert("prometheus")] })),
		).toEqual({ kind: "alert", source: "prometheus" });
	});
	it("reads any other webhook source as a webhook", () => {
		expect(
			triggerOf(incident({ alertCount: 1, alerts: [alert("ci")] })),
		).toEqual({ kind: "webhook", source: "ci" });
	});
});

describe("thread rows", () => {
	it("puts a working thread in Active and a failed one in Needs you", () => {
		const working = incidentRow(
			incident({ investigations: [run({ status: "running", completedAt: null })] }),
		);
		const failed = incidentRow(
			incident({ investigations: [run({ status: "failed" })] }),
		);
		expect([working.section, working.state]).toEqual(["active", "working"]);
		expect([failed.section, failed.state]).toEqual(["needs", "failed"]);
	});
	it("settles a resolved thread with no state", () => {
		const row = incidentRow(incident({ status: "closed" }), true);
		expect([row.section, row.state]).toEqual(["settled", null]);
	});
	it("ranks an ask above a failure above a finding", () => {
		const rows = sortRows([
			{ ...incidentRow(incident({})), key: "r", state: "ready" },
			{ ...incidentRow(incident({})), key: "f", state: "failed" },
			{ ...incidentRow(incident({})), key: "a", state: "asks" },
		]);
		expect(rows.map((r) => r.key)).toEqual(["a", "f", "r"]);
	});
	it("shows a schedule by its latest run, and nothing before its first", () => {
		const base = {
			id: "s1",
			name: "Nightly check",
			serviceName: "checkout",
			description: "Every day at 02:00",
			liveRunId: null,
		};
		expect(scheduleRow({ ...base, lastTick: null } as unknown as Schedule)).toBe(
			null,
		);
		const done = scheduleRow({
			...base,
			lastTick: { decidedAt: at(3), run: { id: "r1", status: "completed" } },
		} as unknown as Schedule);
		expect([done?.origin, done?.section, done?.schedule?.runId]).toEqual([
			"schedule",
			"settled",
			"r1",
		]);
		const live = scheduleRow({
			...base,
			liveRunId: "r2",
			lastTick: null,
		} as unknown as Schedule);
		expect([live?.section, live?.state]).toEqual(["active", "working"]);
	});
});

describe("plain chats started from Home (#1020 D10)", () => {
	const chat = (p: Partial<IncidentWithRelations>) =>
		incident({ tags: ["chat"], ...p } as Partial<IncidentWithRelations>);
	it("is a chat only with the tag and no alert behind it", () => {
		expect(isPlainChat(chat({}))).toBe(true);
		expect(isPlainChat(incident({}))).toBe(false);
		expect(
			isPlainChat(chat({ alertCount: 1, alerts: [alert("prometheus")] })),
		).toBe(false);
	});
	it("asks nothing of you once answered, and settles", () => {
		const answered = chat({
			investigations: [run({ kind: "chat", status: "completed" })],
		});
		expect(needOf(answered)).toBe(null);
		expect(incidentRow(answered).section).toBe("settled");
	});
	it("stays active while it answers", () => {
		const live = chat({
			investigations: [
				run({ kind: "chat", status: "running", completedAt: null }),
			],
		});
		expect(incidentRow(live).section).toBe("active");
	});
	it("needs you when its run failed", () => {
		const failed = chat({
			investigations: [run({ kind: "chat", status: "failed" })],
		});
		expect(needOf(failed)).toBe("failed");
		expect(incidentRow(failed).section).toBe("needs");
	});
});

describe("generic-first rows (#1020)", () => {
	it("names an alert thread readably and keeps the alert's own state apart", () => {
		const row = incidentRow(
			incident({
				title: "DiskAlmostFull",
				alertCount: 1,
				alerts: [alert("prometheus")],
			}),
		);
		expect(row.title).toBe("Disk almost full");
		expect(ORIGIN_WORD[row.origin]).toBe("Alert");
		expect(row.firing).toBe(true);
	});
	it("keeps a chat's own title and gives it no origin word", () => {
		const row = incidentRow(incident({ title: "Why is CheckoutSlow?" }));
		expect(row.title).toBe("Why is CheckoutSlow?");
		expect(ORIGIN_WORD[row.origin]).toBeNull();
		expect(row.firing).toBe(false);
	});
	it("says what each state is in words", () => {
		expect(STATE_WORD).toEqual({
			asks: "Approval needed",
			failed: "Failed",
			working: "Working",
			ready: "Likely cause",
		});
	});
});
