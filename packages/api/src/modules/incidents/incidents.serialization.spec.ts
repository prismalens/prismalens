// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Regression guard for #320 — the incidents list/detail payload must satisfy
 * the oRPC output contract for the rows Prisma really returns.
 *
 * The defect this pins: before #315 the three incident queries joined the
 * service with `select: { id, name, displayName }` and omitted `completedAt`
 * from the investigation selects, so `ServiceSchema` (which requires `type`,
 * `tier`, `metadata`, `createdAt`, `updatedAt`) and `InvestigationRefSchema`
 * rejected the response and every read returned 500 "Output validation
 * failed". Both halves are asserted here: the query must ask for the whole
 * service row, and the serializer must carry every contract field through.
 */

import type { PrismaService } from "../../core/prisma/prisma.service.js";
import type { TimelineService } from "../timeline/timeline.service.js";
import { IncidentsController } from "./incidents.controller.js";
import { IncidentsService } from "./incidents.service.js";

// Captured verbatim from a live `prisma.incident.findMany(...)` against a
// freshly migrated + auto-seeded (#315) SQLite database. Every column the
// Prisma client returns for these models is present, including the ones the
// contract does not expose (`tenantId`, `discoveryMetadata`, `_count`).
const seededIncidentRow = {
	id: "b0111111-1111-4111-8111-111111111111",
	tenantId: null,
	number: 1,
	title: "[demo] Storm: High 5xx error rate on API Gateway & Auth timeout",
	description:
		"Cascade of 5xx errors on api-gateway following auth-service connection pool saturation.",
	severity: "critical",
	status: "investigating",
	priority: "p1",
	serviceId: "11111111-1111-4111-8111-111111111111",
	assignedToId: null,
	correlationReason: "Correlated 10 high-rate error alerts within 15m window",
	correlationRuleId: "c0111111-1111-4111-8111-111111111111",
	tags: null,
	customerImpact: null,
	affectedSystems: null,
	triggeredAt: new Date("2026-08-03T11:00:00.000Z"),
	acknowledgedAt: null,
	resolvedAt: null,
	alertCount: 10,
	timeToAcknowledge: null,
	timeToResolve: null,
	createdAt: new Date("2026-08-05T18:33:41.936Z"),
	updatedAt: new Date("2026-08-05T18:33:41.936Z"),
	alerts: [
		{
			id: "a1111111-1111-4111-8111-111111111109",
			tenantId: null,
			dedupKey: "demo-storm-alert-9",
			fingerprint: null,
			externalId: null,
			title: "[demo] Storm alert #10: Auth Service Connection Timeout",
			description:
				"High error rate observed on auth-service during traffic burst",
			severity: "high",
			status: "acknowledged",
			source: "prometheus",
			sourceUrl: null,
			serviceId: "22222222-2222-4222-8222-222222222222",
			tags: null,
			labels: '{"storm":"true","index":"9"}',
			triggeredAt: new Date("2026-08-03T11:18:00.000Z"),
			acknowledgedAt: null,
			resolvedAt: null,
			occurrenceCount: 1,
			lastOccurrence: new Date("2026-08-05T18:33:42.011Z"),
			rawPayload: null,
			createdAt: new Date("2026-08-05T18:33:42.011Z"),
			updatedAt: new Date("2026-08-05T18:33:42.011Z"),
			incidentId: "b0111111-1111-4111-8111-111111111111",
		},
	],
	service: {
		id: "11111111-1111-4111-8111-111111111111",
		tenantId: null,
		name: "api-gateway",
		displayName: "API Gateway",
		description: "Main ingress API gateway and request router",
		type: "gateway",
		tier: "tier_1",
		team: "platform-eng",
		slackChannel: "#alerts-gateway",
		tags: null,
		metadata: null,
		discoveryMetadata: null,
		// #331: the seed leaves every service UNMAPPED. Present-and-null is the
		// point — the column is on the row Prisma returns, so the serializer has to
		// carry it or `ServiceSchema` rejects the whole incident read.
		localCheckoutPath: null,
		createdAt: new Date("2026-08-05T18:33:41.896Z"),
		updatedAt: new Date("2026-08-05T18:33:41.896Z"),
	},
	investigations: [
		{
			id: "d0111111-1111-4111-8111-111111111111",
			status: "completed",
			summary:
				"Database connection pool exhaustion caused cascading 5xx gateway errors.",
			rootCause:
				"Connection pool size in auth-service was misconfigured and capped at 10 pool connections after release v2.4.1.",
			rootCauseCategory: "config",
			createdAt: new Date("2026-08-05T18:33:42.270Z"),
			completedAt: null,
		},
	],
	_count: { alerts: 10, investigations: 1 },
};

function makeController(): IncidentsController {
	return new IncidentsController(
		null as never,
		null as never,
		null as never,
		null as never,
	);
}

function serialize(row: unknown): unknown {
	const controller = makeController() as unknown as {
		serializeIncidentWithRelations: (incident: unknown) => unknown;
	};
	return controller.serializeIncidentWithRelations(row);
}

describe("incidents query shape", () => {
	// A recording stand-in for PrismaService: every incident read captures the
	// arguments so the `include` clause itself can be asserted.
	function makeRecordingService() {
		const calls: Record<string, unknown>[] = [];
		const record = (args: Record<string, unknown>) => {
			calls.push(args);
			return null;
		};
		const prisma = {
			incident: {
				findUnique: vi.fn(record),
				findMany: vi.fn((args: Record<string, unknown>) => {
					calls.push(args);
					return [];
				}),
				count: vi.fn(() => 0),
			},
		} as unknown as PrismaService;
		const service = new IncidentsService(
			prisma,
			{} as unknown as TimelineService,
		);
		return { service, calls };
	}

	it.each([
		["findById", (s: IncidentsService) => s.findById("some-id")],
		["findByNumber", (s: IncidentsService) => s.findByNumber(1)],
		["findAll", (s: IncidentsService) => s.findAll({ limit: 50, offset: 0 })],
	])("%s joins the whole service row, not a partial select", async (_n, run) => {
		const { service, calls } = makeRecordingService();
		await run(service);

		const include = calls[0].include as Record<string, unknown>;
		// `service: true` returns every column. A `select` block here is the
		// #320 defect: it silently drops contract-required fields.
		expect(include.service).toBe(true);
	});

	it.each([
		["findById", (s: IncidentsService) => s.findById("some-id")],
		["findByNumber", (s: IncidentsService) => s.findByNumber(1)],
		["findAll", (s: IncidentsService) => s.findAll({ limit: 50, offset: 0 })],
	])("%s selects both investigation timestamps", async (_n, run) => {
		const { service, calls } = makeRecordingService();
		await run(service);

		const include = calls[0].include as Record<string, unknown>;
		const investigations = include.investigations as {
			select: Record<string, boolean>;
		};
		expect(investigations.select.createdAt).toBe(true);
		expect(investigations.select.completedAt).toBe(true);
	});
});

describe("incidents serialization contract conformance", () => {
	it("serializes a seeded incident to a contract-valid payload", async () => {
		const { IncidentWithRelationsSchema } = await import(
			"@prismalens/contracts/schemas"
		);

		const result = IncidentWithRelationsSchema.safeParse(
			serialize(seededIncidentRow),
		);

		expect(
			result.success
				? []
				: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
		).toEqual([]);
	});

	it("passes the service's real type and tier through untouched", () => {
		const serialized = serialize(seededIncidentRow) as {
			service: Record<string, unknown>;
		};

		// Guards against "fix by fallback": a `?? "service"` / `?? "tier_3"`
		// default would satisfy the schema while misreporting a tier-1 gateway.
		expect(serialized.service.type).toBe("gateway");
		expect(serialized.service.tier).toBe("tier_1");
		expect(serialized.service.createdAt).toBe("2026-08-05T18:33:41.896Z");
		expect(serialized.service.updatedAt).toBe("2026-08-05T18:33:41.896Z");
	});

	it("serializes an incident with no service and no investigations", async () => {
		const { IncidentWithRelationsSchema } = await import(
			"@prismalens/contracts/schemas"
		);

		const result = IncidentWithRelationsSchema.safeParse(
			serialize({
				...seededIncidentRow,
				serviceId: null,
				service: null,
				investigations: [],
			}),
		);

		expect(
			result.success
				? []
				: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
		).toEqual([]);
	});

	it("carries the investigation's rootCause through, not dropped by the serializer", () => {
		// The bug: the serializer whitelisted id/status/createdAt/completedAt
		// only, so `rootCause` was always undefined at the client even though
		// Prisma selected it — see IncidentDetailPanel's `latestInvestigation`.
		const serialized = serialize(seededIncidentRow) as {
			investigations: { rootCause: unknown }[];
		};
		expect(serialized.investigations[0].rootCause).toBe(
			seededIncidentRow.investigations[0].rootCause,
		);
	});

	it("preserves a completed investigation's completedAt", async () => {
		const { IncidentWithRelationsSchema } = await import(
			"@prismalens/contracts/schemas"
		);
		const completedAt = new Date("2026-08-05T19:00:00.000Z");

		const serialized = serialize({
			...seededIncidentRow,
			investigations: [{ ...seededIncidentRow.investigations[0], completedAt }],
		});
		const result = IncidentWithRelationsSchema.safeParse(serialized);

		expect(
			result.success
				? []
				: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
		).toEqual([]);
		expect(
			(serialized as { investigations: { completedAt: unknown }[] })
				.investigations[0].completedAt,
		).toBe("2026-08-05T19:00:00.000Z");
	});

	it("surfaces both a newer running investigation and an older completed investigation with its rootCause", async () => {
		const { IncidentWithRelationsSchema } = await import(
			"@prismalens/contracts/schemas"
		);

		const incidentWithMultipleInvestigations = {
			...seededIncidentRow,
			investigations: [
				{
					id: "d0222222-2222-4222-8222-222222222222",
					status: "running",
					summary: null,
					rootCause: null,
					rootCauseCategory: null,
					createdAt: new Date("2026-08-05T19:00:00.000Z"),
					completedAt: null,
				},
				{
					id: "d0111111-1111-4111-8111-111111111111",
					status: "completed",
					summary:
						"Database connection pool exhaustion caused cascading 5xx gateway errors.",
					rootCause:
						"Connection pool size in auth-service was misconfigured and capped at 10 pool connections after release v2.4.1.",
					rootCauseCategory: "config",
					createdAt: new Date("2026-08-05T18:33:42.270Z"),
					completedAt: new Date("2026-08-05T18:35:00.000Z"),
				},
			],
		};

		const serialized = serialize(incidentWithMultipleInvestigations) as {
			investigations: Array<{
				id: string;
				status: string;
				rootCause: string | null;
				createdAt: string;
				completedAt: string | null;
			}>;
		};

		const result = IncidentWithRelationsSchema.safeParse(serialized);
		expect(
			result.success
				? []
				: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
		).toEqual([]);

		expect(serialized.investigations).toHaveLength(2);
		expect(serialized.investigations[0].status).toBe("running");
		expect(serialized.investigations[0].rootCause).toBeNull();
		expect(serialized.investigations[1].status).toBe("completed");
		expect(serialized.investigations[1].rootCause).toBe(
			"Connection pool size in auth-service was misconfigured and capped at 10 pool connections after release v2.4.1.",
		);
	});
});
