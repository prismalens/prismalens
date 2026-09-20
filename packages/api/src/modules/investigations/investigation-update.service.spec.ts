// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@nestjs/common";
import type { Alert, Incident, Investigation } from "@prismalens/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import type { TimelineService } from "../timeline/timeline.service.js";
import type { InvestigationTriggerService } from "./investigation-trigger.service.js";
import {
	type AlertAddedEvent,
	InvestigationUpdateService,
} from "./investigation-update.service.js";

const INVESTIGATION = { id: "inv-1", status: "running" } as Investigation;

function event(): AlertAddedEvent {
	return {
		alertId: "alert-2",
		incidentId: "inc-1",
		alert: { title: "Checkout 500s", severity: "high" } as Alert,
		incident: { id: "inc-1" } as Incident,
		previousAlertCount: 1,
	};
}

describe("InvestigationUpdateService — an alert that arrives mid-run (#564)", () => {
	let timeline: { create: ReturnType<typeof vi.fn> };
	let service: InvestigationUpdateService;

	beforeEach(() => {
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
		timeline = { create: vi.fn(async () => ({})) };
		service = new InvestigationUpdateService(
			{} as PrismaService,
			{} as InvestigationTriggerService,
			timeline as unknown as TimelineService,
		);
	});

	it("notify: says on the incident timeline that the running report will not cover it", async () => {
		await service.notifyInvestigation(INVESTIGATION, event());

		expect(timeline.create).toHaveBeenCalledTimes(1);
		const entry = timeline.create.mock.calls[0][0];
		expect(entry).toMatchObject({
			incidentId: "inc-1",
			// Not `alert_added`: the incident's own add path already wrote that.
			type: "custom",
			title: "Alert arrived during the investigation",
			metadata: { investigationId: "inv-1", alertId: "alert-2" },
		});
		expect(entry.description).toContain("Checkout 500s");
		expect(entry.description).toContain("Re-run the investigation");
	});

	it("queue_partial: says nothing is queued, because nothing is", async () => {
		await service.queuePartialUpdate(INVESTIGATION, event());

		expect(timeline.create.mock.calls[0][0].description).toContain(
			"Partial re-analysis is not built",
		);
	});

	it("a failed timeline write never throws at the caller", async () => {
		timeline.create.mockRejectedValue(new Error("db gone"));

		await expect(
			service.notifyInvestigation(INVESTIGATION, event()),
		).resolves.toBeUndefined();
	});
});
