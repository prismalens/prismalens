// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { PreRunDetailSchema, PreRunSummarySchema } from "@prismalens/contracts/schemas";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import type { SettingsService } from "../../core/settings/settings.service.js";
import type { OverlayService } from "../overlay/overlay.service.js";
import type { TimelineService } from "../timeline/timeline.service.js";
import type { InternalInvestigationResultDto } from "./dto/index.js";
import { InvestigationsService, preRunDetailOf } from "./investigations.service.js";

function serviceWith(kind = "investigation", stopRequestedAt: Date | null = null) {
	// The guarded write honours the WHERE the way SQLite would (#673 w59).
	const refuses = (where: { stopRequestedAt?: null }) =>
		"stopRequestedAt" in where && stopRequestedAt !== null;
	const tx = {
		investigation: {
			updateMany: vi.fn(async ({ where }: { where: { stopRequestedAt?: null } }) => ({
				count: refuses(where) ? 0 : 1,
			})),
		},
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
			updateMany: vi.fn(async ({ where }: { where: { stopRequestedAt?: null } }) => ({
				count: refuses(where) ? 0 : 1,
			})),
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
		{} as never,
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

			expect(tx.investigation.updateMany).toHaveBeenCalled();
			expect(tx.incident.update).not.toHaveBeenCalled();
			expect(tx.incident.updateMany).not.toHaveBeenCalled();
		},
	);
});

describe("a stop asked for wins every terminal write (#673 w59, OBJ-010 a)", () => {
	it("the status write skips once stopRequestedAt is set and says so", async () => {
		const { service, prisma } = serviceWith("investigation", new Date());
		const findUnique = vi.mocked(prisma.investigation.findUnique);
		findUnique.mockClear();

		expect(
			await service.updateStatusInternal("inv-1", "failed", undefined, "boom"),
		).toBeNull();
		expect(prisma.investigation.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					stopRequestedAt: null,
					NOT: { status: "cancelled" },
				}),
				data: expect.objectContaining({ liveTurn: null, stopRequestedAt: null }),
			}),
		);
		expect(findUnique).not.toHaveBeenCalled();
	});

	it("a cancelled write is never refused by the stop guard", async () => {
		const { service, prisma } = serviceWith("investigation", new Date());

		await service.updateStatusInternal("inv-1", "cancelled", undefined, "Investigation cancelled");

		const [[args]] = vi.mocked(prisma.investigation.updateMany).mock.calls as unknown as [
			[{ where: Record<string, unknown> }],
		];
		expect(args.where).not.toHaveProperty("stopRequestedAt");
	});

	it("the result write skips: no recommendations, no timeline entry, no overlay, and null back", async () => {
		const { service, tx, overlay } = serviceWith("investigation", new Date());

		const written = await service.writeResultWithRelations("inv-1", {
			incidentId: "inc-1",
			status: "completed",
			summary: "s",
			report: { summary: "s" },
			recommendations: [{ title: "raise the pool" }],
		} as unknown as InternalInvestigationResultDto);

		expect(written).toBeNull();
		expect(tx.investigation.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ stopRequestedAt: null, report: null }),
			}),
		);
		expect(tx.recommendation.createMany).not.toHaveBeenCalled();
		expect(tx.timelineEntry.create).not.toHaveBeenCalled();
		expect(overlay.computeOverlay).not.toHaveBeenCalled();
	});
});

describe("runs as threads (#673)", () => {
	it("a chat that completes with no report says Chat ended and computes no overlay", async () => {
		const { service, tx, overlay } = serviceWith("chat");

		await service.writeResultWithRelations("inv-1", {
			incidentId: "inc-1",
			status: "completed",
		} as InternalInvestigationResultDto);

		expect(tx.investigation.updateMany).toHaveBeenCalledWith(
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

describe("preRunDetailOf (#848 C16a)", () => {
	it("returns null for null, undefined or unparsable JSON", () => {
		expect(preRunDetailOf(null)).toBeNull();
		expect(preRunDetailOf(undefined)).toBeNull();
		expect(preRunDetailOf("")).toBeNull();
		expect(preRunDetailOf("invalid json")).toBeNull();
		expect(preRunDetailOf(JSON.stringify({ notASnapshot: true }))).toBeNull();
	});

	it("returns the snapshot without excerpts or file contents", () => {
		const rawSnapshot = JSON.stringify({
			fetchedAt: "2026-10-24T10:00:00.000Z",
			window: { start: "2026-10-24T09:00:00.000Z", end: "2026-10-24T10:00:00.000Z" },
			sources: [
				{
					kind: "prometheus",
					label: "prom",
					from: "set",
					status: "found",
					detail: "2 alerts",
					file: "telemetry-prometheus-1.json",
					excerpt: "secret data excerpt that should be dropped",
				},
			],
			notConfigured: [],
			runbooks: [
				{
					title: "rb",
					service: "checkout",
					path: "runbooks/checkout.md",
					origin: "repo",
				},
			],
			checkoutsSkipped: [],
			files: [
				{
					name: "telemetry-prometheus-1.json",
					about: "prom: 2 alerts",
					text: "full file content that should be dropped",
				},
			],
		});

		const detail = preRunDetailOf(rawSnapshot);
		expect(detail?.state).toBe("ready");
		const summary = detail?.state === "ready" ? detail : null;
		expect(PreRunSummarySchema.safeParse(summary).success).toBe(true);
		expect(PreRunDetailSchema.safeParse(detail).success).toBe(true);
		expect(summary?.sources[0]).toEqual({
			kind: "prometheus",
			label: "prom",
			from: "set",
			status: "found",
			detail: "2 alerts",
			file: "telemetry-prometheus-1.json",
		});
		expect((summary?.sources[0] as Record<string, unknown>).excerpt).toBeUndefined();
		expect(summary?.files).toEqual([
			{
				name: "telemetry-prometheus-1.json",
				about: "prom: 2 alerts",
			},
		]);
		expect((summary?.files[0] as Record<string, unknown>).text).toBeUndefined();
	});

	it("returns a not-saved marker itself with saveError and valid schema", () => {
		const marker = {
			state: "not-saved" as const,
			fetchedAt: "2026-10-24T10:00:00.000Z",
			window: { start: "2026-10-24T09:00:00.000Z", end: "2026-10-24T10:00:00.000Z" },
			sources: [
				{
					kind: "prometheus" as const,
					label: "prom",
					from: "set" as const,
					status: "found" as const,
					detail: "2 alerts",
					file: "telemetry-prometheus-1.json",
				},
			],
			notConfigured: [],
			runbooks: [],
			checkoutsSkipped: [],
			files: [{ name: "telemetry-prometheus-1.json", about: "prom: 2 alerts" }],
			saveError: "the database write failed",
		};
		const detail = preRunDetailOf(JSON.stringify(marker));
		expect(detail).toEqual(marker);
		expect(detail?.state).toBe("not-saved");
		if (detail?.state === "not-saved") {
			expect(detail.saveError).toBe("the database write failed");
		}
		expect(PreRunDetailSchema.safeParse(detail).success).toBe(true);
	});

	it("returns an unavailable marker with state unavailable and reason", () => {
		const marker = {
			state: "unavailable" as const,
			reason: "no stored snapshot for this run",
		};
		const detail = preRunDetailOf(JSON.stringify(marker));
		expect(detail).toEqual({
			state: "unavailable",
			reason: "no stored snapshot for this run",
		});
		expect(PreRunDetailSchema.safeParse(detail).success).toBe(true);
	});

	it("returns null for state ready or bogus markers", () => {
		expect(preRunDetailOf(JSON.stringify({ state: "ready", files: [], sources: [] }))).toBeNull();
		expect(preRunDetailOf(JSON.stringify({ state: "bogus" }))).toBeNull();
	});
});
