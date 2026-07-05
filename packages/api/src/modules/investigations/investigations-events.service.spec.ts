// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic tests for the durable event record on InvestigationsService (ADR-0018
 * B.4): the idempotent bulk `appendEvents` and the paginated `getEvents` replay.
 * Prisma is a double covering exactly `investigationEvent.{create,findMany}`.
 */
import { Logger } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import type {
	CanonicalEvent,
	InvestigationReport,
} from "@prismalens/contracts";
import { INVESTIGATION_REPORT_BRANCH } from "@prismalens/contracts";
import { Prisma } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { OverlayService } from "../overlay/overlay.service.js";
import { TimelineService } from "../timeline/timeline.service.js";
import { InvestigationsService } from "./investigations.service.js";

const INV_ID = "11111111-1111-1111-1111-111111111111";
const RUN_ID = "33333333-3333-3333-3333-333333333333";

const REPORT: InvestigationReport = {
	summary: "summary",
	rootCause: null,
	rootCauseCategory: null,
	hypotheses: [],
	ruledOut: [],
	coverage: { queried: [], notQueried: [] },
	nextSteps: [],
};

function stepEvent(seq: number, branchId = "branch-1"): CanonicalEvent {
	return {
		kind: "agent_step",
		runId: RUN_ID,
		branchId,
		path: [],
		seq,
		ts: "2026-07-05T00:00:00.000Z",
		text: "thinking",
		toolCalls: [],
	};
}

function reportEvent(seq: number): CanonicalEvent {
	return {
		kind: "report",
		runId: RUN_ID,
		seq,
		ts: "2026-07-05T00:00:00.000Z",
		report: REPORT,
	};
}

function p2002(): Prisma.PrismaClientKnownRequestError {
	return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
		code: "P2002",
		clientVersion: "7.8.0",
	});
}

function makeMockPrisma() {
	return {
		investigationEvent: {
			create: vi.fn().mockResolvedValue({}),
			findMany: vi.fn().mockResolvedValue([]),
		},
	};
}

async function buildService(mockPrisma: ReturnType<typeof makeMockPrisma>) {
	const module: TestingModule = await Test.createTestingModule({
		providers: [
			InvestigationsService,
			{ provide: PrismaService, useValue: mockPrisma },
			{ provide: TimelineService, useValue: {} },
			{ provide: OverlayService, useValue: {} },
		],
	}).compile();
	return module.get<InvestigationsService>(InvestigationsService);
}

describe("InvestigationsService — durable event record", () => {
	let mockPrisma: ReturnType<typeof makeMockPrisma>;
	let service: InvestigationsService;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
		mockPrisma = makeMockPrisma();
		service = await buildService(mockPrisma);
	});

	describe("appendEvents (idempotent bulk insert)", () => {
		it("inserts one row per event, JSON-encoding the full canonical event", async () => {
			const result = await service.appendEvents(INV_ID, [
				stepEvent(1),
				stepEvent(2),
			]);

			expect(result).toEqual({ inserted: 2, duplicates: 0 });
			expect(mockPrisma.investigationEvent.create).toHaveBeenCalledTimes(2);
			const firstArg = mockPrisma.investigationEvent.create.mock.calls[0][0];
			expect(firstArg.data).toMatchObject({
				investigationId: INV_ID,
				seq: 1,
				branchId: "branch-1",
			});
			expect(JSON.parse(firstArg.data.event)).toMatchObject({
				kind: "agent_step",
				seq: 1,
			});
		});

		it("stores the branchId-less terminal report event under the sentinel branch", async () => {
			await service.appendEvents(INV_ID, [reportEvent(99)]);

			expect(
				mockPrisma.investigationEvent.create.mock.calls[0][0].data,
			).toMatchObject({ seq: 99, branchId: INVESTIGATION_REPORT_BRANCH });
		});

		it("swallows a duplicate (P2002) as a no-op — a batch retry is idempotent", async () => {
			mockPrisma.investigationEvent.create
				.mockResolvedValueOnce({})
				.mockRejectedValueOnce(p2002());

			const result = await service.appendEvents(INV_ID, [
				stepEvent(1),
				stepEvent(2),
			]);

			expect(result).toEqual({ inserted: 1, duplicates: 1 });
		});

		it("re-appending the exact same batch is a full no-op (all duplicates)", async () => {
			mockPrisma.investigationEvent.create.mockRejectedValue(p2002());

			const result = await service.appendEvents(INV_ID, [
				stepEvent(1),
				stepEvent(2),
			]);

			expect(result).toEqual({ inserted: 0, duplicates: 2 });
		});

		it("rethrows a non-duplicate DB error (it is not swallowed as a dupe)", async () => {
			mockPrisma.investigationEvent.create.mockRejectedValueOnce(
				new Prisma.PrismaClientKnownRequestError("FK violation", {
					code: "P2003",
					clientVersion: "7.8.0",
				}),
			);

			await expect(
				service.appendEvents(INV_ID, [stepEvent(1)]),
			).rejects.toThrow();
		});
	});

	describe("getEvents (seq-cursor replay)", () => {
		it("parses stored blobs back through the schema and returns a null nextCursor under a full page", async () => {
			mockPrisma.investigationEvent.findMany.mockResolvedValueOnce([
				{
					id: "r1",
					seq: 1,
					branchId: "branch-1",
					event: JSON.stringify(stepEvent(1)),
				},
				{
					id: "r2",
					seq: 2,
					branchId: "branch-1",
					event: JSON.stringify(stepEvent(2)),
				},
			]);

			const page = await service.getEvents(INV_ID, undefined, 100);

			expect(page.events).toHaveLength(2);
			expect(page.events[0]).toMatchObject({ kind: "agent_step", seq: 1 });
			expect(page.nextCursor).toBeNull();
			// First page: no cursor filter applied.
			expect(
				mockPrisma.investigationEvent.findMany.mock.calls[0][0].where,
			).toEqual({ investigationId: INV_ID });
		});

		it("applies the exclusive seq cursor and reports nextCursor when more rows exist", async () => {
			// take = limit + 1: the overflow row (seq 3) proves there is a next page.
			mockPrisma.investigationEvent.findMany.mockResolvedValueOnce([
				{
					id: "r2",
					seq: 2,
					branchId: "branch-1",
					event: JSON.stringify(stepEvent(2)),
				},
				{
					id: "r3",
					seq: 3,
					branchId: "branch-1",
					event: JSON.stringify(stepEvent(3)),
				},
			]);

			const page = await service.getEvents(INV_ID, 1, 1);

			expect(page.events).toHaveLength(1);
			expect(page.events[0]).toMatchObject({ seq: 2 });
			expect(page.nextCursor).toBe(2);
			const query = mockPrisma.investigationEvent.findMany.mock.calls[0][0];
			expect(query.where).toEqual({ investigationId: INV_ID, seq: { gt: 1 } });
			expect(query.take).toBe(2);
		});

		it("never splits a same-seq fan-out group across a page boundary", async () => {
			// limit 3, branches b1..b3: page would end mid-group at seq 2 — the whole
			// seq-2 group is held back and re-read by the next page's cursor.
			mockPrisma.investigationEvent.findMany.mockResolvedValueOnce([
				{
					id: "r1",
					seq: 1,
					branchId: "b1",
					event: JSON.stringify(stepEvent(1, "b1")),
				},
				{
					id: "r2",
					seq: 1,
					branchId: "b2",
					event: JSON.stringify(stepEvent(1, "b2")),
				},
				{
					id: "r3",
					seq: 2,
					branchId: "b1",
					event: JSON.stringify(stepEvent(2, "b1")),
				},
				{
					id: "r4",
					seq: 2,
					branchId: "b2",
					event: JSON.stringify(stepEvent(2, "b2")),
				},
			]);

			const page = await service.getEvents(INV_ID, undefined, 3);

			expect(page.events).toHaveLength(2);
			expect(page.events.every((e) => e.seq === 1)).toBe(true);
			expect(page.nextCursor).toBe(1);
		});

		it("returns a seq group wider than the limit whole instead of looping", async () => {
			const group = ["b1", "b2", "b3"].map((b, i) => ({
				id: `r${i}`,
				seq: 5,
				branchId: b,
				event: JSON.stringify(stepEvent(5, b)),
			}));
			// First fetch (take limit+1 = 2): both rows share seq 5 → trimming would
			// empty the page, so the service refetches the entire group.
			mockPrisma.investigationEvent.findMany
				.mockResolvedValueOnce(group.slice(0, 2))
				.mockResolvedValueOnce(group);

			const page = await service.getEvents(INV_ID, 4, 1);

			expect(page.events).toHaveLength(3);
			expect(page.nextCursor).toBe(5);
			expect(
				mockPrisma.investigationEvent.findMany.mock.calls[1][0].where,
			).toEqual({ investigationId: INV_ID, seq: 5 });
		});

		it("drops a corrupt row rather than surfacing it", async () => {
			mockPrisma.investigationEvent.findMany.mockResolvedValueOnce([
				{ id: "r1", seq: 1, branchId: "branch-1", event: "not json{" },
				{
					id: "r2",
					seq: 2,
					branchId: "branch-1",
					event: JSON.stringify(stepEvent(2)),
				},
			]);

			const page = await service.getEvents(INV_ID, undefined, 100);

			expect(page.events).toHaveLength(1);
			expect(page.events[0]).toMatchObject({ seq: 2 });
		});
	});
});
