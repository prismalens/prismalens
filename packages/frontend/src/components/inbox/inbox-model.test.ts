// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { middle, runLabel } from "../shell/IncidentTree";
import {
	actionsOf,
	firingOf,
	firingSeries,
	groupNeeds,
	needOf,
	reasonOf,
	sparkPoints,
} from "./inbox-model";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

type Run = NonNullable<IncidentWithRelations["investigations"]>[number];
type Alert = NonNullable<IncidentWithRelations["alerts"]>[number];

function run(p: Partial<Run>): Run {
	return {
		id: crypto.randomUUID(),
		status: "completed",
		kind: "investigation",
		rootCause: null,
		createdAt: at(2),
		completedAt: at(1.9),
		...p,
	} as Run;
}

function alert(p: Partial<Alert>): Alert {
	return {
		id: crypto.randomUUID(),
		status: "triggered",
		triggeredAt: at(5),
		resolvedAt: null,
		...p,
	} as Alert;
}

function incident(p: Partial<IncidentWithRelations>): IncidentWithRelations {
	return {
		id: crypto.randomUUID(),
		number: 1,
		title: "WalkGrouped",
		status: "investigating",
		severity: "high",
		triggeredAt: at(13),
		alertCount: 1,
		alerts: [alert({})],
		investigations: [],
		...p,
	} as IncidentWithRelations;
}

describe("needOf", () => {
	it("puts a named cause in Finding ready, even while a follow-up runs", () => {
		const i = incident({
			investigations: [
				run({ status: "running", createdAt: at(0.1), completedAt: null }),
				run({ rootCause: "v1.42 sorts notes in Python" }),
			],
		});
		expect(needOf(i)).toBe("ready");
		expect(reasonOf(i, "ready", NOW).tag).toBe("Checking a follow-up.");
	});

	it("leaves an incident out while its first run works", () => {
		const i = incident({
			investigations: [run({ status: "running", completedAt: null })],
		});
		expect(needOf(i)).toBeNull();
	});

	it("does not hide a failed run behind a live chat", () => {
		const i = incident({
			investigations: [
				run({ kind: "chat", status: "running", completedAt: null }),
				run({ status: "failed", error: "rate limit" }),
			],
		});
		expect(needOf(i)).toBe("failed");
	});

	it("groups failed and stopped runs together, Retry first", () => {
		const stopped = incident({
			alerts: [alert({ status: "resolved", resolvedAt: at(1) })],
			investigations: [run({ status: "cancelled" })],
		});
		expect(needOf(stopped)).toBe("failed");
		expect(reasonOf(stopped, "failed", NOW).tag).toBe("Stopped by you");
		expect(actionsOf(stopped, "failed", "clear")).toMatchObject({
			primary: { label: "Retry run" },
			secondary: { label: "Resolve" },
		});
	});

	it("calls a never-run incident No cause found with Investigate", () => {
		const i = incident({});
		expect(needOf(i)).toBe("nocause");
		expect(reasonOf(i, "nocause", NOW).text).toBe("Not investigated yet");
		expect(actionsOf(i, "nocause", "steady").primary.label).toBe(
			"Investigate",
		);
	});

	it("offers Merge on a cleared incident that fired again", () => {
		const target = crypto.randomUUID();
		const i = incident({
			status: "resolved",
			resolvedAt: at(4),
			refiredAs: { id: target, number: 11, createdAt: at(1) },
		});
		expect(needOf(i)).toBe("cleared");
		expect(actionsOf(i, "cleared", "clear").primary).toEqual({
			kind: "merge",
			label: "Merge into INC-11",
			targetId: target,
		});
	});

	it("puts a run waiting on approval first", () => {
		const i = incident({
			investigations: [
				run({
					status: "running",
					completedAt: null,
					awaitingApprovalAt: at(0.1),
				}),
			],
		});
		const resolvedOne = incident({ status: "resolved" });
		expect(groupNeeds([resolvedOne, i]).map((g) => g.key)).toEqual([
			"approval",
			"cleared",
		]);
	});

	it("keeps resolved incidents out of the inbox", () => {
		expect(needOf(incident({ status: "closed" }))).toBeNull();
	});
});

describe("firingOf", () => {
	it("is worse only when more alerts fire than an hour ago", () => {
		const i = incident({
			alertCount: 2,
			alerts: [alert({ triggeredAt: at(5) }), alert({ triggeredAt: at(0.2) })],
		});
		expect(firingOf(i, NOW)).toBe("worse");
	});

	it("does not call a brand-new incident worse", () => {
		const i = incident({ alerts: [alert({ triggeredAt: at(0.1) })] });
		expect(firingOf(i, NOW)).toBe("steady");
	});

	it("tells cleared alerts and manual incidents apart", () => {
		expect(
			firingOf(
				incident({ alerts: [alert({ status: "resolved", resolvedAt: at(1) })] }),
				NOW,
			),
		).toBe("clear");
		expect(firingOf(incident({ alertCount: 0, alerts: [] }), NOW)).toBe("none");
	});

	it("draws the last 24 hours, ending at now", () => {
		const series = firingSeries(
			incident({ alerts: [alert({ triggeredAt: at(3) })] }),
			NOW,
		);
		expect(series).toHaveLength(25);
		expect(series.at(-1)).toBe(1);
		expect(series[0]).toBe(0);
		expect(sparkPoints([0, 0]).split(" ")).toEqual(["0.0,22.0", "72.0,22.0"]);
	});
});

describe("sidebar labels", () => {
	it("keeps both ends of a long title", () => {
		expect(middle("BooklogrApiLatencyP99High")).toBe("BooklogrA…ncyP99High");
		expect(middle("WalkGrouped")).toBe("WalkGrouped");
	});

	it("numbers investigations on their own and names questions", () => {
		const runs = [
			run({ id: "r3", status: "running", createdAt: at(0.1) }),
			run({ id: "a1", kind: "chat", title: "did v1.41 run it?", createdAt: at(1) }),
			run({ id: "r2", rootCause: "sort", createdAt: at(2) }),
			run({ id: "r1", createdAt: at(3) }),
		];
		expect(runs.map((r) => runLabel(runs, r))).toEqual([
			"Run 3, working",
			"Ask: did v1.41 run it?",
			"Run 2, likely cause",
			"Run 1, no cause named",
		]);
	});
});
