// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AlertWithRelations } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { alertDetail, alertGroups, alertName } from "./alert-groups";

function alert(
	title: string,
	over: Partial<AlertWithRelations> = {},
): AlertWithRelations {
	return {
		id: title,
		title,
		severity: "medium",
		status: "triggered",
		labels: null,
		triggeredAt: "2026-09-30T10:00:00Z",
		lastOccurrence: "2026-09-30T10:00:00Z",
		...over,
	} as AlertWithRelations;
}

describe("alertGroups", () => {
	it("names a group by alertname, else by the title's head", () => {
		expect(alertName(alert("x", { labels: { alertname: "HighLatency" } }))).toBe(
			"HighLatency",
		);
		expect(alertName(alert("HighErrorRate on edge-gateway: boom"))).toBe(
			"HighErrorRate",
		);
		expect(
			alertDetail(alert("HighErrorRate on edge-gateway: boom"), "HighErrorRate"),
		).toBe("edge-gateway: boom");
		const storm = alert("[demo] Storm alert #5: API Gateway HTTP 502");
		expect(alertName(storm)).toBe("[demo] Storm alert");
		expect(alertDetail(storm, "[demo] Storm alert")).toBe(
			"#5: API Gateway HTTP 502",
		);
	});

	it("counts a correlated alert as firing (walk f14)", () => {
		const [g] = alertGroups([
			alert("HighErrorRate on a: 1", { status: "correlated" }),
			alert("HighErrorRate on a: 2", { status: "resolved" }),
		]);
		expect([g.name, g.alerts.length, g.firing]).toEqual(["HighErrorRate", 2, 1]);
	});

	it("groups by rule, worst severity and widest window, most firing first", () => {
		const groups = alertGroups([
			alert("QueueBacklog on a: 1", { status: "resolved" }),
			alert("HighErrorRate on a: 1", { severity: "low" }),
			alert("HighErrorRate on a: 2", {
				severity: "critical",
				triggeredAt: "2026-09-30T09:00:00Z",
				lastOccurrence: "2026-09-30T11:00:00Z",
			}),
		]);
		expect(groups.map((g) => [g.name, g.alerts.length, g.firing])).toEqual([
			["HighErrorRate", 2, 2],
			["QueueBacklog", 1, 0],
		]);
		expect(groups[0]).toMatchObject({
			severity: "critical",
			firstAt: "2026-09-30T09:00:00Z",
			lastAt: "2026-09-30T11:00:00Z",
		});
	});
});
