// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { ContextPackService } from "./context-pack.service.js";

/**
 * A prisma double covering exactly the model methods ContextPackService touches.
 * Defaults describe incident `inc-1` (service `svc-pay`) with one alert
 * (`alertname=HighErrorRate`), one deployment change in window, one commit change
 * in window (dropped), one dependent neighbour, and one strongly-similar past
 * incident sharing both the service and the alertname label.
 */
function makeMockPrisma() {
	return {
		incident: {
			findUnique: vi.fn().mockResolvedValue({
				id: "inc-1",
				serviceId: "svc-pay",
				alerts: [
					{
						serviceId: "svc-pay",
						title: "500s spiked",
						labels: JSON.stringify({ alertname: "HighErrorRate", severity: "high" }),
						triggeredAt: new Date("2026-09-19T12:00:00Z"),
					},
				],
			}),
			findMany: vi.fn().mockResolvedValue([
				{
					id: "inc-0",
					number: 7,
					title: "Old checkout outage",
					serviceId: "svc-pay",
					actualCause: null,
					createdAt: new Date("2026-09-10T00:00:00Z"),
					alerts: [
						{
							title: "500s spiked",
							labels: JSON.stringify({ alertname: "HighErrorRate", severity: "high" }),
						},
					],
					investigations: [{ rootCause: "payments-api regression" }],
				},
				{
					id: "inc-unrelated",
					number: 8,
					title: "Unrelated ledger issue",
					serviceId: "svc-ledger",
					actualCause: null,
					createdAt: new Date("2026-09-11T00:00:00Z"),
					alerts: [{ title: "Ledger slow", labels: JSON.stringify({ alertname: "LedgerSlow" }) }],
					investigations: [],
				},
			]),
		},
		changeEvent: {
			findMany: vi.fn().mockImplementation(
				async (args?: {
					where?: { type?: { in?: string[] } };
					take?: number;
				}) => {
					const rows = [
						{
							id: "chg-1",
							type: "deployment",
							source: "github",
							description: "payments-api deploy abc123",
							metadata: JSON.stringify({ sha: "abc123" }),
							timestamp: new Date("2026-09-19T18:00:00Z"),
							serviceId: "svc-pay",
						},
						{
							id: "chg-commit",
							type: "commit",
							source: "github",
							description: "a raw commit",
							metadata: null,
							timestamp: new Date("2026-09-19T17:00:00Z"),
							serviceId: "svc-pay",
						},
					];
					const filtered = args?.where?.type?.in
						? rows.filter((r) => args.where!.type!.in!.includes(r.type))
						: rows;
					return typeof args?.take === "number"
						? filtered.slice(0, args.take)
						: filtered;
				},
			),
		},
		service: {
			findMany: vi.fn().mockResolvedValue([{ id: "svc-pay", name: "payments-api" }]),
			findUnique: vi.fn().mockResolvedValue({ name: "payments-api" }),
		},
		serviceDependency: {
			findMany: vi.fn().mockResolvedValue([
				{
					dependentId: "svc-checkout",
					dependencyId: "svc-pay",
					criticality: "required",
					dependent: { id: "svc-checkout", name: "checkout" },
				},
			]),
		},
	};
}

async function buildService(mockPrisma: ReturnType<typeof makeMockPrisma>) {
	const module: TestingModule = await Test.createTestingModule({
		providers: [ContextPackService, { provide: PrismaService, useValue: mockPrisma }],
	}).compile();
	return module.get<ContextPackService>(ContextPackService);
}

describe("ContextPackService", () => {
	let mockPrisma: ReturnType<typeof makeMockPrisma>;
	let service: ContextPackService;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
		mockPrisma = makeMockPrisma();
		service = await buildService(mockPrisma);
	});

	it("returns null when the incident does not exist", async () => {
		mockPrisma.incident.findUnique.mockResolvedValueOnce(null);
		expect(await service.assemble("missing")).toBeNull();
	});

	it("scopes the window to the alert times and drops commit rows from changes", async () => {
		const pack = await service.assemble("inc-1");

		expect(pack).not.toBeNull();
		expect(pack?.window.start).toBe("2026-09-18T12:00:00.000Z");
		expect(pack?.changes).toHaveLength(1);
		expect(pack?.changes[0]).toMatchObject({
			kind: "deployment",
			service: "payments-api",
			source: "github",
			ref: "abc123",
		});
		expect(mockPrisma.changeEvent.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					type: { in: ["deployment", "config", "migration", "rollback"] },
				}),
				take: 20,
			}),
		);
	});

	it("returns deployment when 25 commit rows are newer than one deployment row", async () => {
		const commits = Array.from({ length: 25 }, (_, i) => ({
			id: `chg-commit-${i}`,
			type: "commit",
			source: "github",
			description: `commit ${i}`,
			metadata: null,
			timestamp: new Date(
				new Date("2026-09-19T19:00:00Z").getTime() + i * 60_000,
			),
			serviceId: "svc-pay",
		}));
		const deployment = {
			id: "chg-deploy-1",
			type: "deployment",
			source: "github",
			description: "payments-api deploy v1",
			metadata: JSON.stringify({ sha: "deploy123" }),
			timestamp: new Date("2026-09-19T18:00:00Z"),
			serviceId: "svc-pay",
		};
		const allRows = [...commits.reverse(), deployment];

		mockPrisma.changeEvent.findMany.mockImplementationOnce(
			async (args?: {
				where?: { type?: { in?: string[] } };
				take?: number;
			}) => {
				const filtered = args?.where?.type?.in
					? allRows.filter((r) => args.where!.type!.in!.includes(r.type))
					: allRows;
				return typeof args?.take === "number"
					? filtered.slice(0, args.take)
					: filtered;
			},
		);

		const pack = await service.assemble("inc-1");

		expect(pack?.changes).toHaveLength(1);
		expect(pack?.changes[0]).toMatchObject({
			kind: "deployment",
			ref: "deploy123",
		});
	});

	it("ranks the one-hop dependent neighbourhood", async () => {
		const pack = await service.assemble("inc-1");
		expect(pack?.neighbors).toEqual([
			{ name: "checkout", relation: "dependent", criticality: "required" },
		]);
	});

	it("ranks prior incidents by shared labels and caps at 5, dropping the unrelated one", async () => {
		const pack = await service.assemble("inc-1");

		expect(pack?.priorIncidents).toHaveLength(1);
		expect(pack?.priorIncidents[0]).toMatchObject({
			reference: "INC-7",
			title: "Old checkout outage",
			rootCause: "payments-api regression",
		});
		expect(pack?.priorIncidents[0].matchedOn).toEqual(
			expect.arrayContaining(["service: payments-api"]),
		);
	});

	it("caps prior incidents at 5, ranked by shared-label count then recency", async () => {
		const make = (number: number, sharedLabels: number, createdAt: string) => ({
			id: `inc-${number}`,
			number,
			title: `Incident ${number}`,
			serviceId: "svc-pay",
			actualCause: null,
			createdAt: new Date(createdAt),
			alerts: [
				{
					title: "x",
					labels: JSON.stringify(
						Object.fromEntries(
							Array.from({ length: sharedLabels }, (_, i) => [`l${i}`, `v${i}`]).concat([
								["alertname", "HighErrorRate"],
							]),
						),
					),
				},
			],
			investigations: [],
		});
		// Current incident's alert only has `alertname` + `severity` labels, so only
		// `alertname` ever overlaps — every candidate below ties on shared-label
		// count (1); ordering is decided by createdAt desc, newest first.
		mockPrisma.incident.findMany.mockResolvedValueOnce([
			make(1, 0, "2026-09-01T00:00:00Z"),
			make(2, 0, "2026-09-02T00:00:00Z"),
			make(3, 0, "2026-09-03T00:00:00Z"),
			make(4, 0, "2026-09-04T00:00:00Z"),
			make(5, 0, "2026-09-05T00:00:00Z"),
			make(6, 0, "2026-09-06T00:00:00Z"),
		]);

		const pack = await service.assemble("inc-1");

		expect(pack?.priorIncidents).toHaveLength(5);
		expect(pack?.priorIncidents.map((p) => p.reference)).toEqual([
			"INC-6",
			"INC-5",
			"INC-4",
			"INC-3",
			"INC-2",
		]);
	});

	it("records an unavailable family when its query throws, and the others still fill", async () => {
		mockPrisma.changeEvent.findMany.mockRejectedValueOnce(new Error("db timeout"));

		const pack = await service.assemble("inc-1");

		expect(pack?.changes).toEqual([]);
		expect(pack?.unavailable).toEqual([{ family: "changes", reason: "db timeout" }]);
		// The other families are unaffected by the changes failure.
		expect(pack?.neighbors).toHaveLength(1);
		expect(pack?.priorIncidents).toHaveLength(1);
	});

	it("caps matchedOn elements at 80 characters when service name is 200 characters", async () => {
		const longServiceName = "a".repeat(200);
		mockPrisma.service.findUnique.mockResolvedValueOnce({ name: longServiceName });

		const pack = await service.assemble("inc-1");

		expect(pack?.priorIncidents).not.toHaveLength(0);
		for (const pi of pack?.priorIncidents ?? []) {
			expect(pi.matchedOn.length).toBeGreaterThan(0);
			for (const m of pi.matchedOn) {
				expect(m.length).toBeLessThanOrEqual(80);
			}
		}
		expect(pack?.priorIncidents?.[0].matchedOn[0]).toBe(
			`service: ${longServiceName}`.slice(0, 80),
		);
		expect(pack?.priorIncidents?.[0].matchedOn[0].length).toBe(80);
	});
});
