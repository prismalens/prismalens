// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Alert } from "@prismalens/database";
import { AlertFactory } from "../../../test/factories/index.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { AlertStatus, IncidentStatus, Severity } from "../../shared/enums/index.js";
import { IncidentsService } from "../incidents/incidents.service.js";
import { AlertsService } from "./alerts.service.js";
import type { CreateAlertDto, UpdateAlertDto } from "./dto/index.js";

// Mock PrismaService to avoid Prisma import.meta issues
const mockPrismaService = {
	alert: {
		create: vi.fn(),
		findUnique: vi.fn(),
		findFirst: vi.fn(),
		findMany: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		count: vi.fn(),
		groupBy: vi.fn(),
	},
	alertSourceAlert: {
		upsert: vi.fn(),
		findFirst: vi.fn(),
		update: vi.fn(),
		count: vi.fn(),
	},
	timelineEntry: {
		create: vi.fn(),
	},
	incident: {
		updateMany: vi.fn(async () => ({ count: 0 })),
	},
	$transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
		fn(mockPrismaService),
	),
};

/** The #231 flap window, in the units the service reads it in (minutes). */
const FLAP_WINDOW_MINUTES = 15;
const mockConfigService = {
	get: vi.fn(() => FLAP_WINDOW_MINUTES),
};

describe("AlertsService (BDD)", () => {
	let service: AlertsService;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockConfigService.get.mockReturnValue(FLAP_WINDOW_MINUTES);
		vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AlertsService,
				{ provide: PrismaService, useValue: mockPrismaService },
				{ provide: ConfigService, useValue: mockConfigService },
			],
		}).compile();

		service = module.get<AlertsService>(AlertsService);
	});

	describe("create", () => {
		it("should create alert with provided data", async () => {
			const createDto: CreateAlertDto = {
				source: "prometheus",
				sourceAlertId: "ext-123",
				title: "Database issue",
				description: "Slow query",
				severity: Severity.high,
				sourceUrl: "https://prometheus.io",
				labels: { env: "prod" },
			};

			const expectedAlert = AlertFactory.create({
				source: createDto.source,
				externalId: createDto.sourceAlertId,
				title: createDto.title,
				description: createDto.description,
				severity: createDto.severity as unknown as string,
				status: "triggered",
				dedupKey: expect.any(String) as unknown as string,
				fingerprint: expect.any(String) as unknown as string,
			});

			// The dedup read is findFirst (dedupKey is not unique — #231 R2b)
			mockPrismaService.alert.findFirst.mockResolvedValue(null);
			mockPrismaService.alert.create.mockResolvedValue(expectedAlert);

			const result = await service.create(createDto);

			expect(result).toEqual(expectedAlert);
			expect(mockPrismaService.alert.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					source: "prometheus",
					title: "Database issue",
					status: "triggered",
				}),
			});
		});

		it("should default severity to medium when not provided", async () => {
			const createDto: CreateAlertDto = {
				source: "github",
				title: "Issue",
				sourceUrl: "https://github.com",
			};

			const expectedAlert = AlertFactory.create({
				severity: "medium",
			});

			mockPrismaService.alert.findFirst.mockResolvedValue(null);
			mockPrismaService.alert.create.mockResolvedValue(expectedAlert);

			await service.create(createDto);

			expect(mockPrismaService.alert.create).toHaveBeenCalledWith({
				data: expect.objectContaining({ severity: "medium" }),
			});
		});

		it("should deduplicate alerts with same dedupKey", async () => {
			const createDto: CreateAlertDto = {
				source: "prometheus",
				title: "Same alert",
				severity: Severity.high,
			};

			const existingAlert = AlertFactory.create({
				occurrenceCount: 1,
			});
			const updatedAlert = AlertFactory.create({
				...existingAlert,
				occurrenceCount: 2,
			});

			mockPrismaService.alert.findFirst.mockResolvedValue(existingAlert);
			mockPrismaService.alert.update.mockResolvedValue(updatedAlert);

			const result = await service.create(createDto);

			expect(result.occurrenceCount).toBe(2);
			expect(mockPrismaService.alert.create).not.toHaveBeenCalled();
			expect(mockPrismaService.alert.update).toHaveBeenCalled();
		});
	});

	describe("generateDedupKey", () => {
		const labelled = (labels: Record<string, string>): CreateAlertDto => ({
			source: "prometheus",
			title: labels.alertname,
			severity: Severity.critical,
			labels,
		});

		it("a labelled alert is its label set: a differing label is another alert, the same set is a refire", () => {
			const base = { alertname: "HighErrorRate", severity: "critical", service: "payments" };
			const same = service.generateDedupKey(labelled(base));
			expect(service.generateDedupKey(labelled({ ...base }))).toBe(same);
			expect(
				service.generateDedupKey(labelled({ ...base, instance: "web-2" })),
			).not.toBe(same);
		});

		it("without labels the identity is source, title, severity and service", () => {
			const dto: CreateAlertDto = {
				source: "api",
				title: "Disk full",
				severity: Severity.high,
				serviceId: "svc-1",
			};
			expect(service.generateDedupKey(dto)).toBe(
				service.generateDedupKey({ ...dto, description: "different text" }),
			);
			expect(service.generateDedupKey(dto)).not.toBe(
				service.generateDedupKey({ ...dto, serviceId: "svc-2" }),
			);
		});
	});

	describe("generateFingerprint (#633 edge 12)", () => {
		const alert = (labels?: Record<string, string>): CreateAlertDto => ({
			source: "prometheus",
			title: "HighLatency",
			description: "p99 above 2s",
			severity: Severity.high,
			...(labels ? { labels } : {}),
		});

		it("two services firing the same alert get two keys, even with neither registered", () => {
			expect(service.generateFingerprint(alert({ alertname: "HighLatency", service: "api" }))).not.toBe(
				service.generateFingerprint(alert({ alertname: "HighLatency", service: "db" })),
			);
		});

		it("instances of one service share a key, so they join one incident", () => {
			expect(
				service.generateFingerprint(alert({ alertname: "HighLatency", service: "api", instance: "a" })),
			).toBe(service.generateFingerprint(alert({ alertname: "HighLatency", service: "api", instance: "b" })));
		});

		it("an alert with no service label keys on title and description as before", () => {
			expect(service.generateFingerprint(alert())).toBe(
				service.generateFingerprint(alert({ alertname: "HighLatency", instance: "x" })),
			);
		});
	});

	// ==========================================================================
	// #231 — ruled dedup / flap-suppression semantics.
	// Fake timers pin "now"; the flap window comes from the injected config mock.
	// ==========================================================================
	describe("create — dedup & flap semantics (#231)", () => {
		const NOW = new Date("2026-08-12T12:00:00.000Z");
		const MINUTE = 60 * 1000;

		const refireDto: CreateAlertDto = {
			source: "prometheus",
			title: "HighErrorRate",
			severity: Severity.high,
		};

		beforeEach(() => {
			vi.useFakeTimers();
			vi.setSystemTime(NOW);
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		/** The row `create()`'s dedup read returns, with a status + resolve time. */
		function existing(overrides: Partial<ReturnType<typeof AlertFactory.create>>) {
			const alert = AlertFactory.create({
				id: "alert-existing",
				occurrenceCount: 3,
				incidentId: "incident-1",
				...overrides,
			});
			// Both reads answer, so the branch under test is the service's, not the
			// mock's — a spec that only stubs findFirst would pass vacuously against
			// the pre-#231 findUnique read.
			mockPrismaService.alert.findFirst.mockResolvedValue(alert);
			mockPrismaService.alert.findUnique.mockResolvedValue(alert);
			mockPrismaService.alert.update.mockImplementation(
				async ({ data }: { data: Record<string, unknown> }) =>
					AlertFactory.create({
						...alert,
						...data,
						occurrenceCount: alert.occurrenceCount + 1,
						status:
							typeof data.status === "string" ? data.status : alert.status,
					}),
			);
			return alert;
		}

		it("R1: a refire inside the flap window reopens a resolved alert to triggered", async () => {
			existing({
				status: AlertStatus.resolved,
				resolvedAt: new Date(NOW.getTime() - 5 * MINUTE),
			});

			const result = await service.create(refireDto);

			expect(mockPrismaService.alert.create).not.toHaveBeenCalled();
			expect(mockPrismaService.alert.update).toHaveBeenCalledWith({
				where: { id: "alert-existing" },
				data: expect.objectContaining({
					occurrenceCount: { increment: 1 },
					status: AlertStatus.triggered,
					resolvedAt: null,
					triggeredAt: NOW,
				}),
			});
			expect(result.status).toBe(AlertStatus.triggered);
			expect(result.occurrenceCount).toBe(4);
		});

		it("R1: the reopen appends a 'reopened by refire (flap)' timeline entry", async () => {
			existing({
				status: AlertStatus.resolved,
				resolvedAt: new Date(NOW.getTime() - 5 * MINUTE),
			});

			await service.create(refireDto);

			expect(mockPrismaService.timelineEntry.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					incidentId: "incident-1",
					title: "Alert reopened by refire (flap)",
				}),
			});
		});

		it("R1: the reopen moves a resolved incident back to triggered and clears resolvedAt (#734)", async () => {
			existing({
				status: AlertStatus.resolved,
				resolvedAt: new Date(NOW.getTime() - 5 * MINUTE),
			});
			mockPrismaService.incident.updateMany.mockResolvedValueOnce({ count: 1 });

			await service.create(refireDto);

			expect(mockPrismaService.incident.updateMany).toHaveBeenCalledWith({
				where: { id: "incident-1", status: IncidentStatus.resolved },
				data: expect.objectContaining({
					status: IncidentStatus.triggered,
					resolvedAt: null,
					timeToResolve: null,
				}),
			});
			expect(mockPrismaService.timelineEntry.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					incidentId: "incident-1",
					title: "Incident reopened: alert refired (flap)",
				}),
			});
		});

		it("R1: an alert with no incident reopens without a timeline entry", async () => {
			existing({
				status: AlertStatus.resolved,
				resolvedAt: new Date(NOW.getTime() - 1 * MINUTE),
				incidentId: null,
			});

			const result = await service.create(refireDto);

			expect(result.status).toBe(AlertStatus.triggered);
			expect(mockPrismaService.timelineEntry.create).not.toHaveBeenCalled();
		});

		it("R2a: a refire of a triggered alert bumps the counter and leaves the status alone", async () => {
			existing({ status: AlertStatus.triggered, resolvedAt: null });

			const result = await service.create(refireDto);

			expect(mockPrismaService.alert.create).not.toHaveBeenCalled();
			expect(result.status).toBe(AlertStatus.triggered);
			expect(result.occurrenceCount).toBe(4);
			const [[call]] = mockPrismaService.alert.update.mock.calls as [
				[{ data: Record<string, unknown> }],
			];
			expect(call.data).not.toHaveProperty("status");
		});

		it("R2a: a refire of an acknowledged (in-flight) alert bumps the counter only", async () => {
			existing({ status: AlertStatus.acknowledged, resolvedAt: null });

			const result = await service.create(refireDto);

			expect(result.status).toBe(AlertStatus.acknowledged);
			const [[call]] = mockPrismaService.alert.update.mock.calls as [
				[{ data: Record<string, unknown> }],
			];
			expect(call.data).not.toHaveProperty("status");
		});

		it("R2b: a refire of a resolved alert OUTSIDE the flap window inserts a new alert row", async () => {
			existing({
				status: AlertStatus.resolved,
				resolvedAt: new Date(NOW.getTime() - 16 * MINUTE),
			});
			mockPrismaService.alert.create.mockResolvedValue(
				AlertFactory.create({ id: "alert-new-episode" }),
			);

			const result = await service.create(refireDto);

			expect(mockPrismaService.alert.update).not.toHaveBeenCalled();
			expect(mockPrismaService.alert.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					status: AlertStatus.triggered,
					occurrenceCount: 1,
				}),
			});
			expect(result.id).toBe("alert-new-episode");
		});

		it("a refire on a closed incident is a new episode, even inside the flap window (walk f32)", async () => {
			existing({
				status: AlertStatus.resolved,
				resolvedAt: new Date(NOW.getTime() - 1 * MINUTE),
				incident: { status: IncidentStatus.closed },
			} as Partial<ReturnType<typeof AlertFactory.create>>);
			mockPrismaService.alert.create.mockResolvedValue(
				AlertFactory.create({ id: "alert-new-episode" }),
			);

			const result = await service.create(refireDto);

			expect(mockPrismaService.alert.update).not.toHaveBeenCalled();
			expect(mockPrismaService.alert.create).toHaveBeenCalledTimes(1);
			expect(result.id).toBe("alert-new-episode");
		});

		it("a still-correlated alert on a closed incident refires as a new episode too (walk f32)", async () => {
			existing({
				status: AlertStatus.correlated,
				incident: { status: IncidentStatus.closed },
			} as Partial<ReturnType<typeof AlertFactory.create>>);
			mockPrismaService.alert.create.mockResolvedValue(
				AlertFactory.create({ id: "alert-new-episode" }),
			);

			const result = await service.create(refireDto);

			expect(mockPrismaService.alert.update).not.toHaveBeenCalled();
			expect(result.id).toBe("alert-new-episode");
		});

		it("R1 holds on a resolved incident: a refire inside the window reopens (pinned)", async () => {
			existing({
				status: AlertStatus.resolved,
				resolvedAt: new Date(NOW.getTime() - 1 * MINUTE),
				incident: { status: IncidentStatus.resolved },
			} as Partial<ReturnType<typeof AlertFactory.create>>);

			const result = await service.create(refireDto);

			expect(mockPrismaService.alert.create).not.toHaveBeenCalled();
			expect(result.status).toBe(AlertStatus.triggered);
		});

		it("R2b: the window boundary is inclusive — exactly 15 min still reopens", async () => {
			existing({
				status: AlertStatus.resolved,
				resolvedAt: new Date(NOW.getTime() - 15 * MINUTE),
			});

			const result = await service.create(refireDto);

			expect(mockPrismaService.alert.create).not.toHaveBeenCalled();
			expect(result.status).toBe(AlertStatus.triggered);
		});

		it("R2c: a refire of a suppressed alert bumps the counter and NEVER reopens", async () => {
			existing({
				status: AlertStatus.suppressed,
				resolvedAt: new Date(NOW.getTime() - 1 * MINUTE),
			});

			const result = await service.create(refireDto);

			expect(mockPrismaService.alert.create).not.toHaveBeenCalled();
			expect(result.status).toBe(AlertStatus.suppressed);
			expect(result.occurrenceCount).toBe(4);
			const [[call]] = mockPrismaService.alert.update.mock.calls as [
				[{ data: Record<string, unknown> }],
			];
			expect(call.data).not.toHaveProperty("status");
			expect(mockPrismaService.timelineEntry.create).not.toHaveBeenCalled();
		});

		it("reads the flap window from config, with no caller-side fallback", async () => {
			existing({
				status: AlertStatus.resolved,
				resolvedAt: new Date(NOW.getTime() - 40 * MINUTE),
			});
			mockConfigService.get.mockReturnValue(60);

			const result = await service.create(refireDto);

			expect(mockConfigService.get).toHaveBeenCalledWith(
				"PRISMALENS_ALERT_FLAP_WINDOW_MINUTES",
				{ infer: true },
			);
			expect(result.status).toBe(AlertStatus.triggered);
		});

		it("R2b: a refire of a resolved alert OUTSIDE the flap window with the same sourceAlertId creates a new episode row", async () => {
			const fingerprint = "fp-stable-123";
			existing({
				status: AlertStatus.resolved,
				resolvedAt: new Date(NOW.getTime() - 16 * MINUTE),
				externalId: fingerprint,
			});
			const newEpisodeAlert = AlertFactory.create({
				id: "alert-new-episode",
				externalId: fingerprint,
			});
			mockPrismaService.alert.create.mockResolvedValue(newEpisodeAlert);

			const result = await service.create({
				...refireDto,
				sourceAlertId: fingerprint,
			});

			expect(mockPrismaService.alert.update).not.toHaveBeenCalled();
			expect(mockPrismaService.alert.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					externalId: fingerprint,
					status: AlertStatus.triggered,
					occurrenceCount: 1,
				}),
			});
			expect(result.id).toBe("alert-new-episode");
		});
	});

	describe("findByDedupKey", () => {
		it("finds newest episode by dedupKey using findFirst ordered by triggeredAt desc (#231)", async () => {
			const alert = AlertFactory.create({
				id: "alert-latest",
				dedupKey: "key-123",
			});
			mockPrismaService.alert.findFirst.mockResolvedValue(alert);

			const result = await service.findByDedupKey("key-123");

			expect(result).toEqual(alert);
			expect(mockPrismaService.alert.findFirst).toHaveBeenCalledWith({
				where: { dedupKey: "key-123" },
				orderBy: { triggeredAt: "desc" },
			});
		});
	});

	describe("findBySourceAlertId", () => {
		it("finds newest episode by sourceAlertId using findFirst ordered by triggeredAt desc (#231)", async () => {
			const alert = AlertFactory.create({
				id: "alert-latest",
				externalId: "ext-123",
			});
			mockPrismaService.alert.findFirst.mockResolvedValue(alert);

			const result = await service.findBySourceAlertId("ext-123");

			expect(result).toEqual(alert);
			expect(mockPrismaService.alert.findFirst).toHaveBeenCalledWith({
				where: { externalId: "ext-123" },
				orderBy: { triggeredAt: "desc" },
			});
		});

		it("should return null when alert not found by sourceAlertId", async () => {
			mockPrismaService.alert.findFirst.mockResolvedValue(null);

			const result = await service.findBySourceAlertId("non-existent");

			expect(result).toBeNull();
			expect(mockPrismaService.alert.findFirst).toHaveBeenCalledWith({
				where: { externalId: "non-existent" },
				orderBy: { triggeredAt: "desc" },
			});
		});
	});

	describe("findById", () => {
		it("should return alert when found", async () => {
			const alertId = "alert-123";
			const expectedAlert = AlertFactory.create({ id: alertId });
			mockPrismaService.alert.findUnique.mockResolvedValue(expectedAlert);

			const result = await service.findById(alertId);

			expect(result).toEqual(expectedAlert);
			expect(mockPrismaService.alert.findUnique).toHaveBeenCalledWith({
				where: { id: alertId },
				include: expect.any(Object),
			});
		});

		it("should return null when alert not found", async () => {
			mockPrismaService.alert.findUnique.mockResolvedValue(null);

			const result = await service.findById("non-existent");

			expect(result).toBeNull();
		});
	});

	describe("findAll", () => {
		it("should return all alerts with total count", async () => {
			const alerts = AlertFactory.createMany(3);
			mockPrismaService.alert.findMany.mockResolvedValue(alerts);
			mockPrismaService.alert.count.mockResolvedValue(3);

			const result = await service.findAll();

			expect(result).toEqual({ data: alerts, total: 3 });
			expect(mockPrismaService.alert.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: {},
					orderBy: { triggeredAt: "desc" },
				}),
			);
			expect(mockPrismaService.alert.count).toHaveBeenCalledWith({ where: {} });
		});

		it("should filter by status and return count", async () => {
			const alerts = AlertFactory.createMany(2, { status: "acknowledged" });
			mockPrismaService.alert.findMany.mockResolvedValue(alerts);
			mockPrismaService.alert.count.mockResolvedValue(2);

			const result = await service.findAll({ status: "acknowledged" });

			expect(result.data).toEqual(alerts);
			expect(result.total).toBe(2);
			expect(mockPrismaService.alert.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { status: "acknowledged" },
				}),
			);
		});

		it("should apply pagination and reflect full total count even when data is truncated", async () => {
			const alerts = AlertFactory.createMany(2);
			mockPrismaService.alert.findMany.mockResolvedValue(alerts);
			mockPrismaService.alert.count.mockResolvedValue(5);

			const result = await service.findAll({ limit: 2, offset: 0 });

			expect(result.data.length).toBe(2);
			expect(result.total).toBe(5);
			expect(mockPrismaService.alert.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					take: 2,
					skip: 0,
				}),
			);
		});
	});

	describe("findAll with the unassigned filter", () => {
		// The row window has to apply to the unassigned set itself; filtering a
		// page of 100 in the browser instead hides every triggered alert behind
		// newer resolved ones.
		type StatusFilter = string | { in: readonly string[] } | undefined;
		type AlertWhere = {
			incidentId?: string | null;
			status?: StatusFilter;
			severity?: string;
		};

		const matches = (alert: Alert, where: AlertWhere): boolean => {
			if ("incidentId" in where && alert.incidentId !== where.incidentId) {
				return false;
			}
			if (where.severity !== undefined && alert.severity !== where.severity) {
				return false;
			}
			const status = where.status;
			if (typeof status === "string") return alert.status === status;
			if (status) return status.in.includes(alert.status);
			return true;
		};

		const seedPrisma = (rows: Alert[]) => {
			mockPrismaService.alert.findMany.mockImplementation(
				({
					where,
					take,
					skip,
				}: {
					where: AlertWhere;
					take?: number;
					skip?: number;
				}) => {
					const offset = skip ?? 0;
					const filtered = rows
						.filter((a) => matches(a, where))
						.sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime());
					return Promise.resolve(
						filtered.slice(
							offset,
							take === undefined ? undefined : offset + take,
						),
					);
				},
			);
			mockPrismaService.alert.count.mockImplementation(
				({ where }: { where: AlertWhere }) =>
					Promise.resolve(rows.filter((a) => matches(a, where)).length),
			);
		};

		const EPOCH = new Date("2026-08-20T00:00:00.000Z").getTime();
		const minutesAgo = (n: number) => new Date(EPOCH - n * 60_000);
		const INCIDENT_ID = "c0000000-0000-4000-8000-000000000001";

		const buildRows = (unassignedCount: number): Alert[] => [
			// Newest and incident-less, but not "unassigned" by the shared definition.
			...Array.from({ length: 120 }, (_, i) =>
				AlertFactory.create({
					status: i % 2 === 0 ? "resolved" : "suppressed",
					incidentId: null,
					triggeredAt: minutesAgo(i),
				}),
			),
			// Older, and the set both the Unmapped tab and the dashboard mean.
			...Array.from({ length: unassignedCount }, (_, i) =>
				AlertFactory.create({
					status: i % 2 === 0 ? "triggered" : "acknowledged",
					incidentId: null,
					triggeredAt: minutesAgo(200 + i),
				}),
			),
			...Array.from({ length: 10 }, (_, i) =>
				AlertFactory.create({
					status: "triggered",
					incidentId: INCIDENT_ID,
					triggeredAt: minutesAgo(300 + i),
				}),
			),
		];

		it("returns the triggered and acknowledged alerts even when 120 newer incident-less alerts are resolved or suppressed", async () => {
			seedPrisma(buildRows(30));

			const result = await service.findAll({ unassigned: true, limit: 100 });

			expect(result.total).toBe(30);
			expect(result.data).toHaveLength(30);
			expect(
				result.data.every(
					(a) =>
						a.incidentId === null &&
						(a.status === "triggered" || a.status === "acknowledged"),
				),
			).toBe(true);
		});

		it("reports the full unassigned count in total even when the page is capped at 100", async () => {
			seedPrisma(buildRows(130));

			const result = await service.findAll({ unassigned: true, limit: 100 });

			expect(result.data).toHaveLength(100);
			expect(result.total).toBe(130);
		});

		it("builds the where clause from incidentId null and the shared status set", async () => {
			seedPrisma(buildRows(30));

			await service.findAll({ unassigned: true, limit: 100 });

			expect(mockPrismaService.alert.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: {
						incidentId: null,
						status: { in: ["triggered", "acknowledged"] },
					},
					take: 100,
				}),
			);
		});

		it("intersects with an explicit status instead of letting either filter win", async () => {
			seedPrisma(buildRows(30));

			const acknowledged = await service.findAll({
				unassigned: true,
				status: "acknowledged",
			});
			expect(acknowledged.total).toBe(15);
			expect(acknowledged.data.every((a) => a.status === "acknowledged")).toBe(
				true,
			);

			const resolved = await service.findAll({
				unassigned: true,
				status: "resolved",
			});
			expect(resolved.total).toBe(0);
			expect(resolved.data).toHaveLength(0);
		});

		it("still honours severity alongside the unassigned filter", async () => {
			seedPrisma([
				AlertFactory.create({
					status: "triggered",
					incidentId: null,
					severity: "critical",
					triggeredAt: minutesAgo(1),
				}),
				AlertFactory.create({
					status: "triggered",
					incidentId: null,
					severity: "low",
					triggeredAt: minutesAgo(2),
				}),
			]);

			const result = await service.findAll({
				unassigned: true,
				severity: "critical",
			});

			expect(result.total).toBe(1);
			expect(result.data[0]?.severity).toBe("critical");
		});
	});

	describe("update", () => {
		it("should update and return alert", async () => {
			const alertId = "alert-123";
			const updateDto: UpdateAlertDto = { title: "Updated" };
			const updatedAlert = AlertFactory.create({
				id: alertId,
				title: "Updated",
			});
			mockPrismaService.alert.update.mockResolvedValue(updatedAlert);

			const result = await service.update(alertId, updateDto);

			expect(result).toEqual(updatedAlert);
			expect(mockPrismaService.alert.update).toHaveBeenCalledWith({
				where: { id: alertId },
				data: expect.objectContaining({ title: "Updated" }),
			});
		});

		it("should return null when update fails", async () => {
			mockPrismaService.alert.update.mockRejectedValue(new Error("Not found"));

			const result = await service.update("non-existent", { title: "Title" });

			expect(result).toBeNull();
		});
	});

	describe("updateStatus", () => {
		it("should update status", async () => {
			const alertId = "alert-123";
			const updatedAlert = AlertFactory.create({
				id: alertId,
				status: "resolved",
			});
			mockPrismaService.alert.update.mockResolvedValue(updatedAlert);

			const result = await service.updateStatus(alertId, "resolved");

			expect(result).toEqual(updatedAlert);
			expect(mockPrismaService.alert.update).toHaveBeenCalledWith({
				where: { id: alertId },
				data: expect.objectContaining({ status: "resolved" }),
			});
		});
	});

	describe("delete", () => {
		it("should delete alert and return true", async () => {
			mockPrismaService.alert.delete.mockResolvedValue(AlertFactory.create());

			const result = await service.delete("alert-123");

			expect(result).toBe(true);
			expect(mockPrismaService.alert.delete).toHaveBeenCalledWith({
				where: { id: "alert-123" },
			});
		});

		it("should return false when delete fails", async () => {
			mockPrismaService.alert.delete.mockRejectedValue(new Error("Not found"));

			const result = await service.delete("non-existent");

			expect(result).toBe(false);
		});
	});

	describe("count", () => {
		it("should return total count", async () => {
			mockPrismaService.alert.count.mockResolvedValue(42);

			const result = await service.count();

			expect(result).toBe(42);
			expect(mockPrismaService.alert.count).toHaveBeenCalledWith({
				where: {},
			});
		});

		it("should count with filters", async () => {
			mockPrismaService.alert.count.mockResolvedValue(15);

			await service.count({ status: "triggered" });

			expect(mockPrismaService.alert.count).toHaveBeenCalledWith({
				where: { status: "triggered" },
			});
		});
	});

	describe("findAlertBySourceAlert — membership before externalId (#595)", () => {
		it("finds a non-first group member, which externalId alone cannot", async () => {
			// externalId holds only the id of the source alert that CREATED the row,
			// so a lookup keying on it returns null for every other member. The
			// guard that used it made the whole per-member path unreachable.
			mockPrismaService.alertSourceAlert.findFirst.mockResolvedValue({
				id: "mem-B",
				alertId: "alt-group",
				sourceAlertId: "fp-B",
			});
			mockPrismaService.alert.findUnique.mockResolvedValue({
				id: "alt-group",
				externalId: "fp-A",
				status: "triggered",
			});

			const found = await service.findAlertBySourceAlert("fp-B");

			expect(found?.id).toBe("alt-group");
			expect(mockPrismaService.alert.findFirst).not.toHaveBeenCalled();
		});

		it("falls back to externalId when no membership row exists", async () => {
			mockPrismaService.alertSourceAlert.findFirst.mockResolvedValue(null);
			mockPrismaService.alert.findFirst.mockResolvedValue({
				id: "alt-legacy",
				externalId: "fp-old",
			});

			const found = await service.findAlertBySourceAlert("fp-old");

			expect(found?.id).toBe("alt-legacy");
		});
	});

	describe("resolveSourceAlert — deduped group membership (#595)", () => {
		const groupAlert = {
			id: "alt-group",
			status: "triggered",
			dedupKey: "k",
			externalId: "fp-A",
		};

		it("does NOT resolve the alert while another member is still firing", async () => {
			mockPrismaService.alertSourceAlert.findFirst.mockResolvedValue({
				id: "mem-A",
				alertId: "alt-group",
				sourceAlertId: "fp-A",
			});
			mockPrismaService.alertSourceAlert.update.mockResolvedValue({});
			mockPrismaService.alertSourceAlert.count.mockResolvedValue(1);
			mockPrismaService.alert.findUnique.mockResolvedValue(groupAlert);

			const result = await service.resolveSourceAlert("fp-A");

			// The condition is still live on the other instance, so resolving the
			// row would be a lie — this is the bug #595 was filed for.
			expect(mockPrismaService.alert.update).not.toHaveBeenCalled();
			expect(result?.status).toBe("triggered");
		});

		it("resolves the alert when the last member resolves", async () => {
			mockPrismaService.alertSourceAlert.findFirst.mockResolvedValue({
				id: "mem-B",
				alertId: "alt-group",
				sourceAlertId: "fp-B",
			});
			mockPrismaService.alertSourceAlert.update.mockResolvedValue({});
			mockPrismaService.alertSourceAlert.count.mockResolvedValue(0);
			mockPrismaService.alert.findUnique.mockResolvedValue(groupAlert);
			mockPrismaService.alert.update.mockResolvedValue({
				...groupAlert,
				status: "resolved",
			});

			const result = await service.resolveSourceAlert("fp-B");

			expect(mockPrismaService.alert.update).toHaveBeenCalled();
			expect(result?.status).toBe("resolved");
		});

		it("resolves a member whose id is only on the alert row (pre-#595 data)", async () => {
			mockPrismaService.alertSourceAlert.findFirst.mockResolvedValue(null);
			mockPrismaService.alert.findFirst.mockResolvedValue(groupAlert);
			mockPrismaService.alert.update.mockResolvedValue({
				...groupAlert,
				status: "resolved",
			});

			const result = await service.resolveSourceAlert("fp-A");

			expect(result?.status).toBe("resolved");
		});

		it("returns null for a source alert id belonging to no group", async () => {
			mockPrismaService.alertSourceAlert.findFirst.mockResolvedValue(null);
			mockPrismaService.alert.findFirst.mockResolvedValue(null);

			expect(await service.resolveSourceAlert("fp-nobody")).toBeNull();
		});
	});


	describe("resolve → flap refire → resolve (#734)", () => {
		it("the incident reopens on the refire and resolves again with its own resolvedAt", async () => {
			vi.useFakeTimers();
			const T0 = new Date("2026-09-27T09:03:31.000Z");
			vi.setSystemTime(T0);
			const incident = {
				id: "inc-1",
				status: IncidentStatus.triggered as string,
				triggeredAt: T0,
				resolvedAt: null as Date | null,
				timeToResolve: null as number | null,
			};
			let alert = AlertFactory.create({
				id: "alert-1",
				incidentId: "inc-1",
				status: AlertStatus.correlated,
				occurrenceCount: 1,
			});
			const db = {
				alert: {
					findFirst: vi.fn(async () => alert),
					findMany: vi.fn(async () => (alert.status === AlertStatus.resolved ? [] : [{ id: alert.id }])),
					updateMany: vi.fn(),
					update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
						alert = AlertFactory.create({
							...alert,
							...data,
							occurrenceCount: alert.occurrenceCount + 1,
						});
						return alert;
					}),
				},
				alertSourceAlert: { upsert: vi.fn(), updateMany: vi.fn() },
				incident: {
					findUnique: vi.fn(async () => ({ ...incident })),
					update: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
						Object.assign(incident, data),
					),
					updateMany: vi.fn(
						async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
							if (incident.status !== where.status) return { count: 0 };
							Object.assign(incident, data);
							return { count: 1 };
						},
					),
				},
				timelineEntry: { create: vi.fn() },
				$transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
			};
			const timeline = { create: vi.fn() };
			const incidents = new IncidentsService(
				db as never,
				timeline as never,
				{ capture: vi.fn() } as never,
			);
			const alerts = new AlertsService(db as never, mockConfigService as never);

			// The alert resolves, and with it the incident.
			vi.setSystemTime(new Date("2026-09-27T09:04:11.000Z"));
			alert = AlertFactory.create({ ...alert, status: AlertStatus.resolved, resolvedAt: new Date() });
			await incidents.resolve("inc-1");
			expect(incident.status).toBe(IncidentStatus.resolved);
			const firstResolvedAt = incident.resolvedAt;
			expect(firstResolvedAt).toEqual(new Date("2026-09-27T09:04:11.000Z"));

			// It refires 40 s later, inside the window: the incident opens again.
			vi.setSystemTime(new Date("2026-09-27T09:04:51.000Z"));
			await alerts.create({ source: "prometheus", title: alert.title, severity: alert.severity as Severity });
			expect(alert.status).toBe(AlertStatus.triggered);
			expect(incident.status).toBe(IncidentStatus.triggered);
			expect(incident.resolvedAt).toBeNull();

			// Its next resolution closes the incident again, stamped anew.
			vi.setSystemTime(new Date("2026-09-27T09:09:21.000Z"));
			await incidents.resolve("inc-1");
			expect(incident.status).toBe(IncidentStatus.resolved);
			expect(incident.resolvedAt).toEqual(new Date("2026-09-27T09:09:21.000Z"));
			expect(timeline.create).toHaveBeenCalledTimes(2);
			vi.useRealTimers();
		});
	});
});
