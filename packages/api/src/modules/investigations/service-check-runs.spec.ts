// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A service check's run with no incident, over a temp SQLite database (#979): its
 * timeline writes, and the promotion that links it to an incident on a finding.
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { InvestigationReport } from "@prismalens/contracts/schemas";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { InternalInvestigationResultDto } from "./dto/index.js";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-check-runs-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root };
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { IncidentsService } = await import("../incidents/incidents.service.js");
const { TimelineService } = await import("../timeline/timeline.service.js");
const { InvestigationsService } = await import("./investigations.service.js");

let prisma: InstanceType<typeof PrismaService>;
let timeline: InstanceType<typeof TimelineService>;
let investigations: InstanceType<typeof InvestigationsService>;
let serviceId: string;
let incidentNo = 0;
const computeOverlay = vi.fn(async () => undefined);

const found = (statement = "The pool is exhausted"): InvestigationReport =>
	({
		summary: "The checkout pool is exhausted.",
		rootCause: statement,
		hypotheses: [
			{
				statement,
				status: "confirmed",
				evidence: [{ observation: "pool at 100%", source: "curl prometheus", status: "verified", direction: "supports" }],
			},
		],
		nextSteps: [],
	}) as unknown as InvestigationReport;

const inferred = (): InvestigationReport =>
	({
		summary: "Looks fine.",
		rootCause: null,
		hypotheses: [
			{
				statement: "Nothing wrong",
				status: "supported",
				evidence: [{ observation: "it seemed fine", source: "reasoning", status: "inferred", direction: "supports" }],
			},
		],
		nextSteps: [],
	}) as unknown as InvestigationReport;

async function check(over: Record<string, unknown> = {}) {
	return prisma.investigation.create({
		data: {
			incidentId: null,
			serviceId,
			scheduleId: "sch-1",
			scheduleRevision: 1,
			status: "running",
			title: "Morning check",
			triggerType: "scheduled",
			...over,
		},
	});
}

async function openIncident(title: string, status = "investigating", at = Date.now()) {
	incidentNo++;
	return prisma.incident.create({
		data: { number: 1000 + incidentNo, title, status, serviceId, createdAt: new Date(at) },
	});
}

const result = (over: Partial<InternalInvestigationResultDto> = {}) =>
	({ incidentId: null, status: "completed", summary: "The checkout pool is exhausted.", report: found(), ...over }) as unknown as InternalInvestigationResultDto;

const counts = async () => ({
	incidents: await prisma.incident.count(),
	timeline: await prisma.timelineEntry.count(),
});

beforeAll(async () => {
	const { resolveMigrationsDir, runMigrations } = await import("@prismalens/database/migrator");
	await runMigrations({ migrationsDir: resolveMigrationsDir(), log: () => {} });
	prisma = new PrismaService();
	await prisma.$connect();
	serviceId = (await prisma.service.create({ data: { name: `checkout-${randomUUID()}` } })).id;
	timeline = new TimelineService(prisma);
	const incidents = new IncidentsService(prisma, timeline, {} as never);
	investigations = new InvestigationsService(
		prisma,
		timeline,
		{ computeOverlay } as never,
		{ isResetting: () => false, resetGeneration: () => 0, resetSince: () => false } as never,
		incidents,
	);
});

afterAll(async () => {
	await prisma.$disconnect();
	rmSync(env.root, { recursive: true, force: true });
});

beforeEach(async () => {
	await prisma.timelineEntry.deleteMany();
	await prisma.recommendation.deleteMany();
	await prisma.investigation.deleteMany();
	await prisma.incident.deleteMany();
	computeOverlay.mockClear();
});

describe("a run with no incident writes no timeline (#979)", () => {
	it("TimelineService.create answers null and writes nothing", async () => {
		const entry = await timeline.create({ incidentId: null, type: "investigation_started", title: "x" } as never);

		expect(entry).toBeNull();
		expect(await prisma.timelineEntry.count()).toBe(0);
	});

	it("cancelling a pending run, and an orphaned one, ends each cancelled", async () => {
		const pending = await check({ status: "pending" });
		const orphan = await check({ status: "running" });

		expect(await investigations.cancelPending(pending.id, null)).toMatchObject({ status: "cancelled" });
		expect(await investigations.cancelPending(orphan.id, null, "The investigation was cancelled; no run held it.")).toMatchObject({
			status: "cancelled",
		});
		expect(await prisma.timelineEntry.count()).toBe(0);
	});

	it("a result write that finds nothing completes the run, keeps it unlinked and writes no timeline", async () => {
		const run = await check();

		const written = await investigations.writeResultWithRelations(run.id, result({ report: inferred() }));

		expect(written).toMatchObject({ status: "completed", incidentId: null });
		expect(await counts()).toEqual({ incidents: 0, timeline: 0 });
	});

	it("a failure write ends the run failed with its error and writes no timeline", async () => {
		const run = await check();

		const written = await investigations.writeResultWithRelations(run.id, result({ status: "failed", error: "agent crashed", report: undefined }));

		expect(written).toMatchObject({ status: "failed", error: "agent crashed", incidentId: null });
		expect(await counts()).toEqual({ incidents: 0, timeline: 0 });
	});
});

describe("a finding links the check to an incident (#979, adversary OBJ-010)", () => {
	it("creates an incident on the service when none is open, and links the run in the same write", async () => {
		const run = await check();

		const written = await investigations.writeResultWithRelations(run.id, result());

		const incident = await prisma.incident.findFirstOrThrow();
		expect(incident).toMatchObject({ title: "Scheduled check: Morning check", severity: "medium", serviceId, status: "triggered" });
		expect(written?.incidentId).toBe(incident.id);
		const titles = (await prisma.timelineEntry.findMany({ where: { incidentId: incident.id } })).map((t) => t.title);
		expect(titles).toEqual(expect.arrayContaining(["Incident created", "Investigation completed"]));
		expect(titles).toContain("Scheduled check found: The checkout pool is exhausted.");
	});

	it("names the incident after the service when the run has no schedule name", async () => {
		const run = await check({ title: null });

		await investigations.writeResultWithRelations(run.id, result());

		const service = await prisma.service.findUniqueOrThrow({ where: { id: serviceId } });
		expect((await prisma.incident.findFirstOrThrow()).title).toBe(`Scheduled check: ${service.name}`);
	});

	it("links to the newest incident on the service that is not resolved or closed, creating none", async () => {
		await openIncident("older open", "triggered", Date.now() - 3_000);
		const newest = await openIncident("newest open", "monitoring", Date.now() - 2_000);
		await openIncident("newer but resolved", "resolved", Date.now() - 1_000);
		await openIncident("newest but closed", "closed", Date.now());
		const run = await check();

		const written = await investigations.writeResultWithRelations(run.id, result());

		expect(written?.incidentId).toBe(newest.id);
		expect(await prisma.incident.count()).toBe(4);
		expect((await prisma.timelineEntry.findMany({ where: { incidentId: newest.id } })).map((t) => t.title)).toContain(
			"Scheduled check found: The checkout pool is exhausted.",
		);
	});

	it("never links to another service's open incident", async () => {
		const other = await prisma.service.create({ data: { name: `other-${randomUUID()}` } });
		incidentNo++;
		await prisma.incident.create({ data: { number: 2000 + incidentNo, title: "elsewhere", serviceId: other.id } });
		const run = await check();

		const written = await investigations.writeResultWithRelations(run.id, result());

		expect(await prisma.incident.count()).toBe(2);
		expect(written?.incidentId).not.toBeNull();
		expect((await prisma.incident.findUniqueOrThrow({ where: { id: written?.incidentId as string } })).serviceId).toBe(serviceId);
	});

	it("a repeated result write changes nothing", async () => {
		const run = await check();
		const first = await investigations.writeResultWithRelations(run.id, result());
		const after = await counts();

		const again = await investigations.writeResultWithRelations(run.id, result());

		expect(first?.incidentId).not.toBeNull();
		expect(again).toBeNull();
		expect(await counts()).toEqual(after);
		expect((await prisma.investigation.findUniqueOrThrow({ where: { id: run.id } })).incidentId).toBe(first?.incidentId);
	});

	it("a run already linked to an incident is left where it is", async () => {
		const mine = await openIncident("mine");
		await openIncident("newer open", "triggered", Date.now() + 5_000);
		const run = await check({ incidentId: mine.id });

		const written = await investigations.writeResultWithRelations(run.id, result({ incidentId: mine.id }));

		expect(written?.incidentId).toBe(mine.id);
		expect(await prisma.incident.count()).toBe(2);
	});

	it("does not promote a result with no verified support, or a failed run", async () => {
		const quiet = await check();
		const failed = await check();

		await investigations.writeResultWithRelations(quiet.id, result({ report: inferred() }));
		await investigations.writeResultWithRelations(failed.id, result({ status: "failed", error: "boom" }));

		expect(await counts()).toEqual({ incidents: 0, timeline: 0 });
		expect((await prisma.investigation.findUniqueOrThrow({ where: { id: quiet.id } })).incidentId).toBeNull();
	});

	it("a rollback after the incident was created leaves no incident and the run unlinked", async () => {
		const run = await check();
		const dup = randomUUID();

		const written = await investigations.writeResultWithRelations(
			run.id,
			result({
				recommendations: [
					{ id: dup, title: "a" },
					{ id: dup, title: "b" },
				] as never,
			}),
		);

		expect(written).toBeNull();
		expect(await counts()).toEqual({ incidents: 0, timeline: 0 });
		expect(await prisma.investigation.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "running", incidentId: null });
	});

	it("an incident-owned run's result write is unchanged", async () => {
		const inc = await openIncident("mine");
		const run = await check({ incidentId: inc.id, serviceId: null, scheduleId: null });

		await investigations.writeResultWithRelations(run.id, result({ incidentId: inc.id }));

		expect(await prisma.incident.count()).toBe(1);
		expect((await prisma.timelineEntry.findMany()).map((t) => t.title)).toEqual(["Investigation completed"]);
	});
});
