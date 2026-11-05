// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	ThreadRow as FeedRow,
	IncidentWithRelations,
	ThreadUnit,
} from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { needOf } from "@/components/inbox/inbox-model";
import { isPlainChat, triggerOf } from "@/lib/trigger";
import { ORIGIN_WORD, STATE_WORD, unitRow, unitState } from "./ThreadList";

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

const thread = (p: Partial<FeedRow>) =>
	({
		id: crypto.randomUUID(),
		incidentId: null,
		scheduleId: null,
		repositoryId: null,
		kind: "chat",
		status: "completed",
		title: "Why is the cart slow?",
		rootCause: null,
		triggerType: "manual",
		section: "settled",
		lastActivityAt: at(5),
		lastVisitedAt: null,
		settledAt: null,
		unseen: false,
		latestText: null,
		projectName: null,
		titleSetBy: null,
		serviceName: null,
		createdAt: at(1),
		startedAt: at(1),
		awaitingApprovalAt: null,
		...p,
	}) as FeedRow;
const unit = (threads: FeedRow[], chip?: ThreadUnit["incident"]) =>
	({
		section: threads[0]?.section ?? "settled",
		incident: chip ?? null,
		threads,
	}) as ThreadUnit;
const chipOf = (inc: IncidentWithRelations, number: number) =>
	({
		id: inc.id,
		number,
		title: inc.title,
		severity: "high",
		status: "investigating",
	}) as ThreadUnit["incident"];

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

describe("one state per row (#1020)", () => {
	it("ranks an ask above a failure above a run above a finding", () => {
		const ask = thread({ status: "running", awaitingApprovalAt: at(4) });
		const failed = thread({ status: "failed", unseen: true });
		const live = thread({ status: "running" });
		const found = thread({ unseen: true, rootCause: "Index dropped" });
		expect(unitState([found, live, failed, ask])).toBe("asks");
		expect(unitState([found, live, failed])).toBe("failed");
		expect(unitState([found, live])).toBe("working");
		expect(unitState([found])).toBe("ready");
	});
	it("marks an unread answer new and a read one quiet", () => {
		expect(unitState([thread({ unseen: true })])).toBe("new");
		expect(unitState([thread({})])).toBe(null);
	});
	it("says what each state is in words", () => {
		expect(STATE_WORD).toEqual({
			asks: "Approval needed",
			failed: "Failed",
			working: "Working",
			ready: "Likely cause",
			new: "New",
		});
	});
});

describe("feed rows (#1020)", () => {
	it("opens a project thread on its own page, named by its project", () => {
		const t = thread({ repositoryId: "r1", projectName: "payments-api" });
		const row = unitRow(unit([t]));
		expect(row.link).toEqual({ to: "/threads/$id", params: { id: t.id } });
		expect([row.origin, row.service, row.title]).toEqual([
			"you",
			"payments-api",
			"Why is the cart slow?",
		]);
	});
	it("opens a schedule's run under its schedule", () => {
		const t = thread({ scheduleId: "s1", kind: "investigation" });
		const row = unitRow(unit([t]));
		expect(ORIGIN_WORD[row.origin]).toBe("Scheduled");
		expect(row.link).toEqual({
			to: "/schedules/$id/runs/$runId",
			params: { id: "s1", runId: t.id },
		});
	});
	it("makes an incident's threads one row on the incident", () => {
		const inc = incident({
			title: "DiskAlmostFull",
			alertCount: 1,
			alerts: [alert("prometheus")],
		});
		const a = thread({ incidentId: inc.id, kind: "investigation" });
		const b = thread({
			incidentId: inc.id,
			kind: "investigation",
			status: "running",
		});
		const row = unitRow(unit([a, b], chipOf(inc, 7)), inc);
		expect(row.title).toBe("Disk almost full");
		expect(row.key).toBe(`i-${inc.id}`);
		expect(row.link).toEqual({ to: "/incidents/$id", params: { id: inc.id } });
		expect([ORIGIN_WORD[row.origin], row.firing, row.state]).toEqual([
			"Alert",
			true,
			"working",
		]);
		expect(row.hint).toContain("INC-7");
	});
	it("tells a webhook event from an alert, and never says it fires", () => {
		const inc = incident({
			title: "CI failed on main",
			alertCount: 1,
			alerts: [alert("ci")],
		});
		const row = unitRow(
			unit(
				[thread({ incidentId: inc.id, triggerType: "webhook" })],
				chipOf(inc, 2),
			),
			inc,
		);
		expect([ORIGIN_WORD[row.origin], row.firing]).toEqual(["Webhook", false]);
	});
	it("opens a plain chat on its conversation, without an incident number", () => {
		const inc = incident({ tags: ["chat"], title: "Why is CheckoutSlow?" });
		const row = unitRow(
			unit([thread({ incidentId: inc.id })], chipOf(inc, 3)),
			inc,
		);
		expect(row.title).toBe("Why is CheckoutSlow?");
		expect(ORIGIN_WORD[row.origin]).toBeNull();
		expect(row.link).toEqual({
			to: "/incidents/$id/conversation",
			params: { id: inc.id },
		});
		expect(row.hint).not.toContain("INC-");
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
	it("needs you when its run failed, and nothing once answered", () => {
		expect(
			needOf(
				chat({ investigations: [run({ kind: "chat", status: "failed" })] }),
			),
		).toBe("failed");
		expect(
			needOf(
				chat({ investigations: [run({ kind: "chat", status: "completed" })] }),
			),
		).toBe(null);
	});
});
