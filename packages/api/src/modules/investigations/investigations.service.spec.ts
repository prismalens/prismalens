// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import type { SettingsService } from "../../core/settings/settings.service.js";
import type { OverlayService } from "../overlay/overlay.service.js";
import type { TimelineService } from "../timeline/timeline.service.js";
import type { InternalInvestigationResultDto } from "./dto/index.js";
import { InvestigationsService } from "./investigations.service.js";

function serviceWith(kind = "investigation") {
	const tx = {
		investigation: { update: vi.fn() },
		recommendation: { createMany: vi.fn() },
		timelineEntry: { create: vi.fn() },
		incident: { update: vi.fn(), updateMany: vi.fn() },
	};
	const prisma = {
		investigation: {
			findUnique: vi.fn(async () => ({
				incidentId: "inc-1",
				status: "running",
				kind,
			})),
			findMany: vi.fn(async () => []),
			count: vi.fn(async () => 0),
		},
		$transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
			fn(tx),
		),
	};
	const overlay = { computeOverlay: vi.fn(async () => undefined) };
	const service = new InvestigationsService(
		prisma as unknown as PrismaService,
		{ create: vi.fn() } as unknown as TimelineService,
		overlay as unknown as OverlayService,
		{} as SettingsService,
	);
	vi.spyOn(service, "findById").mockResolvedValue(null);
	return { service, tx, prisma, overlay };
}

describe("writeResultWithRelations", () => {
	it.each(["completed", "failed"] as const)(
		"a %s run leaves the incident's status alone (#673 w20)",
		async (status) => {
			const { service, tx } = serviceWith();

			await service.writeResultWithRelations("inv-1", {
				incidentId: "inc-1",
				status,
				rootCause: "a bad deploy",
			} as InternalInvestigationResultDto);

			expect(tx.investigation.update).toHaveBeenCalled();
			expect(tx.incident.update).not.toHaveBeenCalled();
			expect(tx.incident.updateMany).not.toHaveBeenCalled();
		},
	);
});

describe("runs as threads (#673)", () => {
	it("a chat that completes with no report says Chat ended and computes no overlay", async () => {
		const { service, tx, overlay } = serviceWith("chat");

		await service.writeResultWithRelations("inv-1", {
			incidentId: "inc-1",
			status: "completed",
		} as InternalInvestigationResultDto);

		expect(tx.investigation.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ status: "completed", report: null }),
			}),
		);
		expect(tx.timelineEntry.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ title: "Chat ended" }),
		});
		expect(overlay.computeOverlay).not.toHaveBeenCalled();
	});

	it("lists only the incident's runs when asked for one incident", async () => {
		const { service, prisma } = serviceWith();

		await service.findAll({ incidentId: "inc-9", limit: 10, offset: 0 });

		expect(prisma.investigation.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { incidentId: "inc-9" } }),
		);
		expect(prisma.investigation.count).toHaveBeenCalledWith({
			where: { incidentId: "inc-9" },
		});
	});
});
