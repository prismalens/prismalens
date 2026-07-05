import { Logger } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import type { InvestigationReport } from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import type { SimilarIncidentResult } from "./overlay.logic.js";
import { OverlayService } from "./overlay.service.js";

const REPORT: InvestigationReport = {
	summary: "Checkout failing after a deploy",
	rootCause: "payments-api regression",
	rootCauseCategory: "code",
	hypotheses: [
		{
			statement: "The payments-api deployment abc123 regressed checkout",
			status: "supported",
			evidence: [],
		},
	],
	ruledOut: [],
	coverage: { queried: [], notQueried: [] },
	nextSteps: [],
};

/**
 * A prisma double covering exactly the model methods OverlayService touches.
 * Defaults describe one incident (`inc-1`, service `payments-api`) whose report
 * names a real deployment and that has one strongly-similar past incident.
 */
function makeMockPrisma() {
	return {
		investigation: {
			findUnique: vi.fn().mockResolvedValue({
				id: "invA",
				report: JSON.stringify(REPORT),
				rootCauseCategory: "code",
				completedAt: new Date("2026-07-05T12:00:00Z"),
				incident: { id: "inc-1", serviceId: "svc-pay", number: 1 },
			}),
			update: vi.fn().mockResolvedValue({}),
		},
		alert: {
			findMany: vi.fn().mockResolvedValue([
				{
					serviceId: "svc-pay",
					title: "500s spiked",
					labels: JSON.stringify({ severity: "high" }),
					triggeredAt: new Date("2026-07-05T11:00:00Z"),
				},
			]),
		},
		service: {
			findMany: vi.fn().mockResolvedValue([
				{ id: "svc-pay", name: "payments-api" },
				{ id: "svc-ldg", name: "ledger-db" },
			]),
		},
		serviceDependency: {
			findMany: vi
				.fn()
				.mockResolvedValue([
					{ dependentId: "svc-pay", dependencyId: "svc-ldg" },
				]),
		},
		deployment: {
			findMany: vi.fn().mockResolvedValue([
				{
					id: "dep-1",
					name: "payments-api",
					externalId: "abc123",
					branch: "main",
					metadata: null,
					lastDeployedAt: new Date("2026-07-05T10:00:00Z"),
					createdAt: new Date("2026-07-05T10:00:00Z"),
					serviceId: "svc-pay",
				},
			]),
		},
		changeEvent: {
			findMany: vi.fn().mockResolvedValue([]),
		},
		incident: {
			findMany: vi.fn().mockResolvedValue([
				{
					id: "inc-0",
					number: 0,
					title: "Old checkout outage",
					serviceId: "svc-pay",
					alerts: [
						{
							title: "500s spiked",
							labels: JSON.stringify({ severity: "high" }),
						},
					],
					investigations: [{ rootCauseCategory: "code" }],
				},
			]),
		},
		incidentSimilarity: {
			upsert: vi.fn().mockResolvedValue({}),
			deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
		},
	};
}

async function buildService(mockPrisma: ReturnType<typeof makeMockPrisma>) {
	const module: TestingModule = await Test.createTestingModule({
		providers: [
			OverlayService,
			{ provide: PrismaService, useValue: mockPrisma },
		],
	}).compile();
	return module.get<OverlayService>(OverlayService);
}

describe("OverlayService", () => {
	let mockPrisma: ReturnType<typeof makeMockPrisma>;
	let service: OverlayService;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
		mockPrisma = makeMockPrisma();
		service = await buildService(mockPrisma);
	});

	describe("computeOverlay", () => {
		it("correlates changes, ranks proximity, scores similarity, and persists the overlay JSON", async () => {
			const overlay = await service.computeOverlay("invA");

			expect(overlay).not.toBeNull();
			expect(overlay?.matchedChanges).toHaveLength(1);
			expect(overlay?.matchedChanges[0]).toMatchObject({
				id: "dep-1",
				kind: "deployment",
				hypothesisIndex: 0,
			});

			// payments-api is named (self); ledger-db is not named → omitted.
			expect(overlay?.serviceProximity).toHaveLength(1);
			expect(overlay?.serviceProximity[0]).toMatchObject({
				serviceName: "payments-api",
				proximity: 0,
				relation: "self",
			});

			expect(overlay?.similarIncidents).toHaveLength(1);
			expect(overlay?.similarIncidents[0].incidentId).toBe("inc-0");

			// Persisted BESIDE the report as JSON on Investigation.overlay.
			expect(mockPrisma.investigation.update).toHaveBeenCalledWith({
				where: { id: "invA" },
				data: { overlay: expect.any(String) },
			});
			const written = JSON.parse(
				mockPrisma.investigation.update.mock.calls[0][0].data.overlay,
			);
			expect(written.matchedChanges).toHaveLength(1);
			expect(written.similarIncidents[0].incidentId).toBe("inc-0");
		});

		it("writes the similar incident back to IncidentSimilarity via upsert", async () => {
			await service.computeOverlay("invA");

			expect(mockPrisma.incidentSimilarity.upsert).toHaveBeenCalledTimes(1);
			const arg = mockPrisma.incidentSimilarity.upsert.mock.calls[0][0];
			expect(arg.where).toEqual({
				incidentId_similarIncidentId: {
					incidentId: "inc-1",
					similarIncidentId: "inc-0",
				},
			});
			// Score stored as a 0-100 int (strong match → 100).
			expect(arg.create.similarityScore).toBe(100);
			expect(arg.update.similarityScore).toBe(100);
		});

		it("returns null and persists nothing when there is no report to enrich", async () => {
			mockPrisma.investigation.findUnique.mockResolvedValueOnce({
				id: "invA",
				report: null,
				rootCauseCategory: null,
				completedAt: null,
				incident: { id: "inc-1", serviceId: "svc-pay", number: 1 },
			});

			const overlay = await service.computeOverlay("invA");

			expect(overlay).toBeNull();
			expect(mockPrisma.investigation.update).not.toHaveBeenCalled();
			expect(mockPrisma.incidentSimilarity.upsert).not.toHaveBeenCalled();
		});

		it("returns null when the investigation does not exist", async () => {
			mockPrisma.investigation.findUnique.mockResolvedValueOnce(null);
			expect(await service.computeOverlay("missing")).toBeNull();
			expect(mockPrisma.investigation.update).not.toHaveBeenCalled();
		});
	});

	describe("writeSimilarities (upsert idempotency)", () => {
		const similar: SimilarIncidentResult[] = [
			{
				incidentId: "inc-0",
				incidentNumber: 0,
				title: "Old outage",
				score: 0.82,
				factors: { jaccard: 0.5, sameService: true, sharedCategory: true },
			},
		];

		it("prunes rows that fell out of the current top-K so re-runs leave no stale memory", async () => {
			await service.writeSimilarities("inc-1", similar);

			expect(mockPrisma.incidentSimilarity.deleteMany).toHaveBeenCalledWith({
				where: {
					incidentId: "inc-1",
					similarIncidentId: { notIn: ["inc-0"] },
				},
			});
		});

		it("upserts on the composite key (never a bare create) so rows are not duplicated", async () => {
			await service.writeSimilarities("inc-1", similar);

			expect(mockPrisma.incidentSimilarity.upsert).toHaveBeenCalledTimes(1);
			const arg = mockPrisma.incidentSimilarity.upsert.mock.calls[0][0];
			expect(arg.where).toEqual({
				incidentId_similarIncidentId: {
					incidentId: "inc-1",
					similarIncidentId: "inc-0",
				},
			});
			expect(arg.create.similarityScore).toBe(82);
			expect(JSON.parse(arg.update.matchFactors)).toEqual(similar[0].factors);
		});

		it("re-running produces identical upsert targets (idempotent, no growth)", async () => {
			await service.writeSimilarities("inc-1", similar);
			await service.writeSimilarities("inc-1", similar);

			expect(mockPrisma.incidentSimilarity.upsert).toHaveBeenCalledTimes(2);
			const first = mockPrisma.incidentSimilarity.upsert.mock.calls[0][0].where;
			const second =
				mockPrisma.incidentSimilarity.upsert.mock.calls[1][0].where;
			expect(first).toEqual(second);
		});
	});
});
