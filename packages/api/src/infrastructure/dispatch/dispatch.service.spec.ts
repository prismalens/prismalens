// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * DispatchService over a real SQLite database (#673 w59): the boot-time
 * reconciliation that replaces reclaim (0005 §2), follow-up admission as one
 * transaction, the ports' refused writes, and an upgrade from a database that
 * predates `investigation_turns`. The workspace is set before anything reads
 * the config, the way the API scenarios do it.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { InvestigationJobData } from "@prismalens/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunPorts } from "./run-ports.js";

const env = await vi.hoisted(async () => {
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-dispatch-spec-"));
	process.env.PRISMALENS_WORKSPACE_DIR = path.join(root, "data");
	return { root, ports: null as RunPorts | null };
});

vi.mock("./in-process-runner.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./in-process-runner.js")>();
	return {
		...actual,
		createInProcessRunner: (ports: RunPorts) => {
			env.ports = ports;
			return actual.createInProcessRunner(ports);
		},
	};
});

const { PrismaService } = await import("../../core/prisma/prisma.service.js");
const { InvestigationsService } = await import(
	"../../modules/investigations/investigations.service.js"
);
const { DispatchService, FollowUpRefused, resolveHarnessRunModel } = await import(
	"./dispatch.service.js"
);
const { PrismaJobStore } = await import("./job-store.js");
const { createPrismaInvestigationStore } = await import(
	"./prisma-investigation-store.js"
);

type Row = Record<string, unknown>;

/** A minimal in-memory Prisma `job` delegate, for the tests that never reach the database. */
class FakeJobDelegate {
	rows: Row[];
	constructor(rows: Row[]) {
		this.rows = rows;
	}
	async create() {
		throw new Error("not used");
	}
	async findMany(): Promise<Row[]> {
		return [];
	}
	async findUnique(): Promise<Row | null> {
		return null;
	}
	async updateMany(): Promise<{ count: number }> {
		return { count: 0 };
	}
}

function fakePrisma(rows: Row[]) {
	return { job: new FakeJobDelegate(rows) } as unknown as import("../../core/prisma/prisma.service.js").PrismaService;
}

function fakeBus() {
	return { publish: vi.fn(() => 0), subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) };
}

const RESTART_REASON = "API restarted while the run was in flight";
const restoreDone = { status: "completed" as const, completedAt: "2026-09-30T10:00:00.000Z", error: null };

let prisma: InstanceType<typeof PrismaService>;
let investigations: InstanceType<typeof InvestigationsService>;
const timeline = { create: vi.fn(async () => ({})) };
let incidentNo = 0;
/** Legacy rows seeded before `investigation_turns` ran (T14), kept across tests. */
const legacy: Record<"initial" | "chat" | "ask" | "continue", string> = {
	initial: "",
	chat: "",
	ask: "",
	continue: "",
};

beforeAll(async () => {
	const { getConfig } = await import("@prismalens/config");
	if (!getConfig().PRISMALENS_DB_URL.includes(env.root))
		throw new Error(`refusing to run: the config was read first (${getConfig().PRISMALENS_DB_URL})`);
	const { resolveMigrationsDir, runMigrations } = await import("@prismalens/database/migrator");
	// The database as 0.5.0 left it: every migration but investigation_turns.
	const shipped = resolveMigrationsDir();
	const before = mkdtempSync(join(env.root, "before-"));
	for (const name of readdirSync(shipped)) {
		if (name.endsWith("_investigation_turns") || !existsSync(join(shipped, name, "migration.sql"))) continue;
		cpSync(join(shipped, name), join(before, name), { recursive: true });
	}
	await runMigrations({ migrationsDir: before, log: () => {} });
	const { prisma: raw } = await import("@prismalens/database");
	const seed = async (form: keyof typeof legacy, kind: string, payload: (id: string) => Row) => {
		incidentNo++;
		const incidentId = `00000000-0000-4000-8000-0000000000${String(incidentNo).padStart(2, "0")}`;
		const id = `10000000-0000-4000-8000-0000000000${String(incidentNo).padStart(2, "0")}`;
		await raw.$executeRawUnsafe(
			`INSERT INTO "incidents" ("id","number","title","updatedAt") VALUES (?,?,?,?)`,
			incidentId,
			incidentNo,
			`legacy ${form}`,
			Date.now(),
		);
		await raw.$executeRawUnsafe(
			`INSERT INTO "investigations" ("id","incidentId","status","kind","harness","acpSessionId","workspace","updatedAt") VALUES (?,?,?,?,?,?,?,?)`,
			id,
			incidentId,
			"pending",
			kind,
			"opencode",
			"ses_legacy",
			JSON.stringify({ layout: "unmapped", cwd: "/x", repos: [] }),
			Date.now(),
		);
		await raw.$executeRawUnsafe(
			`INSERT INTO "jobs" ("id","investigationId","incidentId","payload","status","updatedAt") VALUES (?,?,?,?,?,?)`,
			`job-legacy-${form}`,
			id,
			incidentId,
			JSON.stringify({ incidentId, investigationId: id, ...payload(id) }),
			"pending",
			Date.now(),
		);
		legacy[form] = id;
	};
	const ask = { text: "why?", mode: "queue", restore: restoreDone };
	await seed("initial", "investigation", () => ({}));
	await seed("chat", "chat", () => ({ kind: "chat", chat: { text: "what fired?" } }));
	await seed("ask", "investigation", () => ({ resume: ask }));
	await seed("continue", "investigation", () => ({
		resume: { ...ask, kind: "continue", restore: { status: "cancelled", completedAt: null, error: null } },
	}));
	// The upgrade itself.
	await runMigrations({ log: () => {} });
	prisma = new PrismaService();
	investigations = new InvestigationsService(
		prisma,
		timeline as never,
		{ computeOverlay: vi.fn(async () => undefined) } as never,
		{ isResetting: () => false, resetGeneration: () => 0, resetSince: () => false } as never,
	);
});

afterAll(() => {
	rmSync(env.root, { recursive: true, force: true });
});

beforeEach(async () => {
	const keep = Object.values(legacy);
	await prisma.job.deleteMany({ where: { investigationId: { notIn: keep } } });
	await prisma.incident.deleteMany({ where: { NOT: { title: { startsWith: "legacy " } } } });
	timeline.create.mockClear();
});

function realDispatch() {
	const deliver = vi.fn(async () => {});
	const telemetry = {
		isEnabled: vi.fn(async () => true),
		capture: vi.fn(async () => {}),
		captureFinished: vi.fn(async () => {}),
	};
	const attach = vi.fn();
	const service = new DispatchService(
		fakeBus() as never,
		{ attach } as never,
		investigations,
		{ findById: vi.fn(async () => null) } as never,
		timeline as never,
		{ resolveSelection: vi.fn(async () => ({ runnable: false })), getSettings: vi.fn(async () => ({})) } as never,
		{} as never,
		prisma,
		{} as never,
		{} as never,
		{} as never,
		telemetry as never,
		{ deliver } as never,
	);
	vi.spyOn(service["dispatcher"], "tick").mockResolvedValue(undefined);
	vi.spyOn(service["dispatcher"], "start").mockImplementation(() => {});
	return { service, deliver, telemetry, attach, ports: env.ports as RunPorts };
}

async function incident(title = `INC ${incidentNo + 1}`) {
	incidentNo++;
	return prisma.incident.create({ data: { number: incidentNo, title } });
}

async function thread(incidentId: string, data: Row = {}, at = Date.now()) {
	return prisma.investigation.create({
		data: {
			incidentId,
			status: "completed",
			harness: "opencode",
			acpSessionId: "ses_1",
			workspace: JSON.stringify({ layout: "unmapped", cwd: "/x", repos: [] }),
			createdAt: new Date(at),
			...data,
		},
	});
}

async function job(investigationId: string, incidentId: string, payload: Partial<InvestigationJobData>, status: string) {
	return prisma.job.create({
		data: {
			investigationId,
			incidentId,
			payload: JSON.stringify({ incidentId, investigationId, ...payload }),
			status,
		},
	});
}

const read = (id: string) => prisma.investigation.findUniqueOrThrow({ where: { id } });

describe("resolveHarnessRunModel (#634, #639)", () => {
	it("resolves a model and its source for a harness that can take one", () => {
		expect(resolveHarnessRunModel("opencode", "synthetic/model-a")).toEqual({
			model: "synthetic/model-a",
			modelSource: "operator",
		});
	});

	it("claims no model and no source for a modelVia: unsupported harness", () => {
		expect(resolveHarnessRunModel("gemini", undefined)).toEqual({});
	});
});

describe("DispatchService.resolveHarness: the run's chips over Settings (#673 w52)", () => {
	function withSettings(settings: Row) {
		const harnessService = {
			resolveSelection: vi.fn(async (asked: { harness?: string }) => ({
				runnable: true,
				harness: asked.harness ?? settings.harness,
				auto: false,
			})),
			getSettings: vi.fn(async () => settings),
		};
		const service = new DispatchService(
			// biome-ignore lint/suspicious/noExplicitAny: constructing directly, bypassing Nest DI.
			fakeBus() as any,
			{ attach: vi.fn() } as any,
			{} as any,
			{} as any,
			{} as any,
			harnessService as any,
			{} as any,
			fakePrisma([]),
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
		);
		return { service, harnessService };
	}
	const settings = {
		harness: "opencode",
		models: { opencode: "vendor/stored", codex: "gpt-stored" },
		efforts: { opencode: "low", codex: "medium" },
		agentModes: { codex: "read-only" },
	};

	it("reads Settings when the run names nothing (an alert's run)", async () => {
		const { service, harnessService } = withSettings(settings);
		await expect(service.resolveHarness()).resolves.toMatchObject({
			selection: { harness: "opencode" },
			model: "vendor/stored",
			modelSource: "operator",
			effort: "low",
		});
		expect(harnessService.resolveSelection).toHaveBeenCalledWith({});
	});

	it("prefers each field the run named, and falls back per field for the rest", async () => {
		const { service, harnessService } = withSettings(settings);
		await expect(
			service.resolveHarness({ harness: "codex", effort: "high" }),
		).resolves.toMatchObject({
			selection: { harness: "codex" },
			model: "gpt-stored",
			effort: "high",
			agentMode: "read-only",
		});
		expect(harnessService.resolveSelection).toHaveBeenCalledWith({
			harness: "codex",
			effort: "high",
		});
		await expect(
			service.resolveHarness({ model: "vendor/asked" }),
		).resolves.toMatchObject({ model: "vendor/asked", effort: "low" });
	});

	it("takes null as the agent's own default, not Settings'", async () => {
		const { service } = withSettings(settings);
		const r = await service.resolveHarness({ model: null, effort: null });
		expect(r.model).toBeUndefined();
		expect(r.effort).toBeUndefined();
	});
});

describe("DispatchService.resumeInvestigation (#747, #673 w59)", () => {
	it("reopens a finished run as pending with an answer turn, and rearms its job with what to put back", async () => {
		const { service, attach } = realDispatch();
		const inc = await incident();
		const done = await thread(inc.id, { completedAt: new Date(restoreDone.completedAt), report: "{}" });
		await job(done.id, inc.id, {}, "succeeded");

		expect(await service.resumeInvestigation(done.id, "why the pool?", "queue")).toBe(true);

		expect(await read(done.id)).toMatchObject({ status: "pending", completedAt: null, liveTurn: "answer" });
		const rearmed = await prisma.job.findUniqueOrThrow({ where: { investigationId: done.id } });
		expect(rearmed.status).toBe("pending");
		expect(JSON.parse(rearmed.payload).resume).toEqual({
			text: "why the pool?",
			mode: "queue",
			kind: "chat",
			restore: restoreDone,
		});
		expect(attach).toHaveBeenCalledWith(done.id);
	});

	it("resumeInvestigation: live check, CAS, liveTurn and job rearm are one transaction; a failing rearm leaves the row and liveTurn untouched (T11)", async () => {
		const { service } = realDispatch();
		const inc = await incident();
		const done = await thread(inc.id, { completedAt: new Date(restoreDone.completedAt) });
		await job(done.id, inc.id, {}, "succeeded");
		const rearm = vi
			.spyOn(PrismaJobStore.prototype, "enqueue")
			.mockRejectedValueOnce(new Error("disk full"));

		await expect(service.resumeInvestigation(done.id, "why?", "queue")).rejects.toThrow("disk full");

		rearm.mockRestore();
		expect(await read(done.id)).toMatchObject({
			status: "completed",
			completedAt: new Date(restoreDone.completedAt),
			liveTurn: null,
		});
		expect((await prisma.job.findUniqueOrThrow({ where: { investigationId: done.id } })).status).toBe("succeeded");
	});

	it("keeps the mode the run ran in, and drops a queued legacy access so the row's default applies (#673 w21)", async () => {
		const { service } = realDispatch();
		const inc = await incident();
		const ran = await thread(inc.id, { agentMode: "acceptEdits" });
		await service.resumeInvestigation(ran.id, "and now?", "queue");
		const kept = await prisma.job.findUniqueOrThrow({ where: { investigationId: ran.id } });
		expect(JSON.parse(kept.payload).agentMode).toBe("acceptEdits");

		const inc2 = await incident();
		const old = await thread(inc2.id, { agentMode: null });
		await job(old.id, inc2.id, { access: "workspace-write" } as never, "succeeded");
		await service.resumeInvestigation(old.id, "and now?", "queue");
		const dropped = await prisma.job.findUniqueOrThrow({ where: { investigationId: old.id } });
		expect(JSON.parse(dropped.payload)).not.toHaveProperty("agentMode");
	});

	it("admits one of two follow-ups sent together", async () => {
		const { service } = realDispatch();
		const inc = await incident();
		const failed = await thread(inc.id, { status: "failed", error: "boom" });

		const results = await Promise.all([
			service.resumeInvestigation(failed.id, "a", "queue"),
			service.resumeInvestigation(failed.id, "b", "queue"),
		]);

		expect(results.filter(Boolean)).toHaveLength(1);
		expect(await prisma.job.count({ where: { investigationId: failed.id } })).toBe(1);
	});

	describe("continue is admitted only on a reportless stopped or failed investigation (T16)", () => {
		it.each([
			["a cancelled chat", { kind: "chat", status: "cancelled" }, "A chat has no report to continue to"],
			["a completed investigation", { status: "completed", report: "{}" }, "This run has its report"],
			["a stopped investigation that has a report", { status: "cancelled", report: "{}" }, "This run has its report"],
		])("refuses %s", async (_name, data, sentence) => {
			const { service } = realDispatch();
			const inc = await incident();
			const row = await thread(inc.id, data);

			await expect(service.resumeInvestigation(row.id, "go on", "queue", "continue")).rejects.toThrow(
				sentence,
			);
			await expect(service.resumeInvestigation(row.id, "go on", "queue", "continue")).rejects.toBeInstanceOf(
				FollowUpRefused,
			);
			expect((await read(row.id)).status).toBe(data.status);
		});

		it("admits a failed reportless investigation, owing a report", async () => {
			const { service } = realDispatch();
			const inc = await incident();
			const row = await thread(inc.id, { status: "failed", error: "report did not validate" });

			expect(await service.resumeInvestigation(row.id, "try the report again", "queue", "continue")).toBe(true);

			expect(await read(row.id)).toMatchObject({ status: "pending", liveTurn: "report", error: null });
			const queued = await prisma.job.findUniqueOrThrow({ where: { investigationId: row.id } });
			expect(JSON.parse(queued.payload).resume).toMatchObject({
				kind: "continue",
				restore: { status: "failed", error: "report did not validate" },
			});
		});
	});

	describe("one live thread per incident (T17, OBJ-007)", () => {
		it("refuses a resume while another row on the incident is live, with the sentence", async () => {
			const { service } = realDispatch();
			const inc = await incident();
			const older = await thread(inc.id, {}, Date.now() - 60_000);
			await thread(inc.id, { status: "running", liveTurn: "report" });

			await expect(service.resumeInvestigation(older.id, "why?", "queue")).rejects.toThrow(
				"Run #2 is working; message it or stop it.",
			);
			expect((await read(older.id)).status).toBe("completed");
		});

		it("a race between a start and a resume leaves one live row", async () => {
			const { service } = realDispatch();
			for (let round = 0; round < 5; round++) {
				const inc = await incident();
				const older = await thread(inc.id, {}, Date.now() - 60_000);
				const settled = await Promise.allSettled([
					investigations.startOrGet({ incidentId: inc.id }),
					service.resumeInvestigation(older.id, "why?", "queue"),
				]);
				const live = await prisma.investigation.count({
					where: { incidentId: inc.id, status: { in: ["pending", "running"] } },
				});
				expect(live, JSON.stringify(settled.map((s) => s.status))).toBe(1);
			}
		});
	});
});

describe("a stale Stop never relabels a finished run (#804 OBJ-025)", () => {
	it("Cancel read the run live, the report landed, then Cancel's fallback ran: completed stands, no Stop lingers", async () => {
		const inc = await incident();
		const completedAt = new Date("2026-10-08T17:02:00.000Z");
		const row = await thread(inc.id, { status: "running", liveTurn: "report" });
		// The run finishes between Cancel's live read and its writes.
		await prisma.investigation.update({
			where: { id: row.id },
			data: { status: "completed", report: "{}", summary: "s", completedAt, liveTurn: null },
		});
		timeline.create.mockClear();

		// What the controller's fallback does next, with no receiver for the publish.
		await investigations.markStopRequested(row.id);
		const cancelled = await investigations.cancelPending(row.id, inc.id, "no run held it");

		expect(cancelled).toBeNull();
		expect(await read(row.id)).toMatchObject({ status: "completed", completedAt, stopRequestedAt: null, report: "{}" });
		expect(timeline.create).not.toHaveBeenCalled();
	});

	it("Stop on an unclaimed Ask whose event read throws once: completed standing, original time and error, stopped, live columns cleared (#804 OBJ-031)", async () => {
		const { service } = realDispatch();
		const inc = await incident();
		const completedAt = new Date(restoreDone.completedAt);
		const row = await thread(inc.id, { status: "pending", liveTurn: "answer", report: "{}", summary: "s" });
		await job(row.id, inc.id, { resume: { text: "why?", mode: "queue", restore: restoreDone } }, "cancelled");
		const seq = vi.spyOn(investigations, "lastEventSeq").mockRejectedValueOnce(new Error("SQLITE_BUSY"));

		expect(await service.restoreFollowUp(row.id, "Stopped before the follow-up started.", "stopped")).toBe(true);

		seq.mockRestore();
		expect(await read(row.id)).toMatchObject({
			status: "completed",
			completedAt,
			error: null,
			lastTurnOutcome: "stopped",
			liveTurn: null,
			stopRequestedAt: null,
			report: "{}",
		});
	});

	it("a pending follow-up that ended meanwhile is not put back, and nothing is said in the conversation", async () => {
		const { service } = realDispatch();
		const inc = await incident();
		const completedAt = new Date("2026-10-08T17:40:00.000Z");
		const row = await thread(inc.id, { status: "completed", report: "{}", completedAt, lastTurnOutcome: "answered" });
		await job(row.id, inc.id, { resume: { text: "why?", mode: "queue", restore: restoreDone } }, "cancelled");

		await service.restoreFollowUp(row.id, "Stopped before the follow-up started.", "stopped");

		expect(await read(row.id)).toMatchObject({ status: "completed", completedAt, lastTurnOutcome: "answered" });
		expect(await prisma.investigationEvent.count({ where: { investigationId: row.id } })).toBe(0);
	});
});

describe("ports: a refused write delivers nothing (T5, OBJ-010 a)", () => {
	it("a failed status write after Stop: false back, no delivery, no telemetry, the row stays live", async () => {
		const { ports, deliver, telemetry } = realDispatch();
		const inc = await incident();
		const row = await thread(inc.id, { status: "running", liveTurn: "report", stopRequestedAt: new Date() });

		expect(await ports.updateStatus(row.id, { status: "failed", error: "boom" })).toBe(false);

		expect(deliver).not.toHaveBeenCalled();
		expect(telemetry.captureFinished).not.toHaveBeenCalled();
		expect(await read(row.id)).toMatchObject({ status: "running", liveTurn: "report" });
	});

	it("a result write after Stop: false back, no recommendation, no timeline entry, no delivery", async () => {
		const { ports, deliver } = realDispatch();
		const inc = await incident();
		const row = await thread(inc.id, { status: "running", liveTurn: "report", stopRequestedAt: new Date() });

		const applied = await ports.writeResult(row.id, {
			status: "completed",
			incidentId: inc.id,
			summary: "pool exhausted",
			report: { summary: "pool exhausted" } as never,
			recommendations: [{ title: "raise the pool" }],
		});

		expect(applied).toBe(false);
		expect(deliver).not.toHaveBeenCalled();
		expect(await prisma.recommendation.count({ where: { investigationId: row.id } })).toBe(0);
		expect(await prisma.timelineEntry.count({ where: { incidentId: inc.id } })).toBe(0);
		expect((await read(row.id)).report).toBeNull();
	});

	it("a result write on an ended row: false back, the row and its timeline untouched", async () => {
		const { ports, deliver } = realDispatch();
		const inc = await incident();
		const row = await thread(inc.id, { status: "failed", error: "boom" });

		const applied = await ports.writeResult(row.id, { status: "completed", incidentId: inc.id, summary: "late" });

		expect(applied).toBe(false);
		expect(deliver).not.toHaveBeenCalled();
		expect(await prisma.timelineEntry.count({ where: { incidentId: inc.id } })).toBe(0);
		expect(await read(row.id)).toMatchObject({ status: "failed", error: "boom" });
	});

	it("an applied write ends the live columns and delivers once", async () => {
		const { ports, deliver } = realDispatch();
		const inc = await incident();
		const row = await thread(inc.id, { status: "running", liveTurn: "report" });

		expect(await ports.updateStatus(row.id, { status: "failed", error: "boom" })).toBe(true);

		expect(deliver).toHaveBeenCalledTimes(1);
		expect(await read(row.id)).toMatchObject({ status: "failed", liveTurn: null, stopRequestedAt: null });
	});
});

describe("boot reconciliation of live rows against their jobs (T12, OBJ-020 window B)", () => {
	const ask = { text: "why the pool?", mode: "queue" as const, restore: restoreDone };

	async function boot() {
		const { service } = realDispatch();
		await service.onModuleInit();
		await service.onApplicationShutdown();
	}

	it("a pending follow-up whose job was cancelled is restored as stopped", async () => {
		const inc = await incident();
		const row = await thread(inc.id, { status: "pending", liveTurn: "answer", report: "{}" });
		await job(row.id, inc.id, { resume: ask }, "cancelled");

		await boot();

		expect(await read(row.id)).toMatchObject({
			status: "completed",
			completedAt: new Date(restoreDone.completedAt),
			lastTurnOutcome: "stopped",
			liveTurn: null,
		});
	});

	it("a pending first run with no job ends failed: restarted before it was queued", async () => {
		const inc = await incident();
		const row = await thread(inc.id, { status: "pending", liveTurn: "report" });

		await boot();

		expect(await read(row.id)).toMatchObject({
			status: "failed",
			error: "PrismaLens restarted before the run was queued",
			liveTurn: null,
		});
	});

	it("a running job whose row recorded a Stop ends cancelled, row and job alike (T6 after a restart, #804 OBJ-027)", async () => {
		const inc = await incident();
		const row = await thread(inc.id, { status: "running", liveTurn: "report", stopRequestedAt: new Date() });
		await job(row.id, inc.id, {}, "running");

		await boot();

		expect(await read(row.id)).toMatchObject({
			status: "cancelled",
			error: "Investigation cancelled",
			stopRequestedAt: null,
			liveTurn: null,
		});
		// What GET /investigations/:id/status serves as `job.state`.
		expect(await realDispatch().service.getJobStatus(row.id)).toMatchObject({ status: "cancelled" });
	});

	it.each([
		["a first run settled cancelled", { status: "cancelled", error: "Investigation cancelled", completedAt: new Date() }, { resume: false }, "cancelled"],
		["a first run settled completed", { status: "completed", report: "{}", completedAt: new Date() }, { resume: false }, "succeeded"],
		["an Ask settled stopped", { status: "completed", report: "{}", lastTurnOutcome: "stopped" }, { resume: true }, "cancelled"],
		["an Ask settled answered", { status: "completed", report: "{}", lastTurnOutcome: "answered" }, { resume: true }, "succeeded"],
		["an Ask settled in error", { status: "completed", report: "{}", lastTurnOutcome: "error" }, { resume: true }, "failed"],
	] as const)(
		"%s, killed before its job completed: the job takes the row's outcome, no restart failure (#804 OBJ-027)",
		async (_name, settled, payload, outcome) => {
			const inc = await incident();
			const row = await thread(inc.id, settled);
			await job(row.id, inc.id, payload.resume ? { resume: ask } : {}, "running");

			await boot();

			expect(await read(row.id)).toMatchObject({ status: settled.status });
			const status = await realDispatch().service.getJobStatus(row.id);
			expect(status?.status).toBe(outcome);
			if (outcome !== "failed") expect(status?.error).not.toBe(RESTART_REASON);
		},
	);

	it("a follow-up whose Stop was recorded before the restart: standing put back, job cancelled (#804 OBJ-027)", async () => {
		const inc = await incident();
		const row = await thread(inc.id, { status: "running", liveTurn: "answer", report: "{}", stopRequestedAt: new Date() });
		await job(row.id, inc.id, { resume: ask }, "running");

		await boot();

		expect(await read(row.id)).toMatchObject({ status: "completed", lastTurnOutcome: "stopped", stopRequestedAt: null });
		expect(await realDispatch().service.getJobStatus(row.id)).toMatchObject({ status: "cancelled" });
	});

	it("a running first run without a Stop ends failed with the restart reason", async () => {
		const inc = await incident();
		const row = await thread(inc.id, { status: "running", liveTurn: "report" });
		await job(row.id, inc.id, {}, "running");

		await boot();

		expect(await read(row.id)).toMatchObject({ status: "failed", error: RESTART_REASON });
	});

	it("a follow-up cut off by a restart puts the finished run back with an error turn, and says so in the conversation", async () => {
		const inc = await incident();
		const row = await thread(inc.id, { status: "running", liveTurn: "answer", report: "{}" });
		await job(row.id, inc.id, { resume: ask }, "running");

		await boot();

		expect(await read(row.id)).toMatchObject({ status: "completed", lastTurnOutcome: "error", liveTurn: null });
		const events = await prisma.investigationEvent.findMany({ where: { investigationId: row.id }, orderBy: { seq: "asc" } });
		expect(events.map((e) => JSON.parse(e.event).kind)).toEqual(["operator_message", "error"]);
	});

	it("an Ask on a stopped reportless run cut off by a restart keeps it cancelled (T9 restart)", async () => {
		const inc = await incident();
		const stopped = { status: "cancelled" as const, completedAt: "2026-10-08T17:04:00.000Z", error: "Investigation cancelled" };
		const row = await thread(inc.id, { status: "running", liveTurn: "answer" });
		await job(row.id, inc.id, { resume: { ...ask, restore: stopped } }, "running");

		await boot();

		expect(await read(row.id)).toMatchObject({
			status: "cancelled",
			error: "Investigation cancelled",
			lastTurnOutcome: "error",
			liveTurn: null,
		});
	});

	it("leaves a row whose job is still pending to be claimed", async () => {
		const inc = await incident();
		const row = await thread(inc.id, { status: "pending", liveTurn: "report" });
		await job(row.id, inc.id, {}, "pending");

		await boot();

		expect(await read(row.id)).toMatchObject({ status: "pending", liveTurn: "report" });
	});

	it("two live rows on one incident from old data: the newest stays, the other is settled", async () => {
		const inc = await incident();
		const older = await thread(inc.id, { status: "pending", liveTurn: "answer", report: "{}" }, Date.now() - 60_000);
		await job(older.id, inc.id, { resume: ask }, "pending");
		const newer = await thread(inc.id, { status: "pending", liveTurn: "report" });
		await job(newer.id, inc.id, {}, "pending");

		await boot();

		expect(await read(newer.id)).toMatchObject({ status: "pending" });
		expect(await read(older.id)).toMatchObject({ status: "completed", lastTurnOutcome: "error", liveTurn: null });
	});
});

describe("upgrade from a database before investigation_turns (T14, OBJ-021)", () => {
	it("one pending job of each form boots, claims, shows the right liveTurn, and refuses a mismatched explicit kind", async () => {
		const { service, ports } = realDispatch();
		await service.onModuleInit();
		await service.onApplicationShutdown();

		// Booted: every legacy row still waits for its claim, intent unknown.
		for (const id of Object.values(legacy)) expect(await read(id)).toMatchObject({ status: "pending", liveTurn: null });
		const ask = await read(legacy.ask);
		expect(await investigations.liveKindRefusal(ask, "chat")).toMatch(/^Run #\d+ is starting; wait$/);

		const claimed = await new PrismaJobStore(prisma.job as never).claim("spec", 10);
		expect(claimed.map((j) => j.investigationId).sort()).toEqual(Object.values(legacy).sort());
		for (const j of claimed) {
			const payload = JSON.parse(j.payload) as InvestigationJobData;
			await createPrismaInvestigationStore(ports, {
				investigationId: j.investigationId,
				incidentId: j.incidentId,
				runId: j.investigationId,
				...(payload.chat ? { chat: true } : {}),
				...(payload.resume ? { resume: { note: "", continuing: payload.resume.kind === "continue" } } : {}),
			}).create();
		}

		expect((await read(legacy.initial)).liveTurn).toBe("report");
		expect((await read(legacy.chat)).liveTurn).toBe("answer");
		expect((await read(legacy.ask)).liveTurn).toBe("answer");
		expect((await read(legacy.continue)).liveTurn).toBe("report");

		expect(await investigations.liveKindRefusal(await read(legacy.ask), "continue")).toMatch(
			/^Run #\d+ is working on an answer; wait or stop it$/,
		);
		expect(await investigations.liveKindRefusal(await read(legacy.continue), "chat")).toMatch(
			/^Run #\d+ is working toward a report; wait or stop it$/,
		);
		expect(await investigations.liveKindRefusal(await read(legacy.ask), "chat")).toBeNull();
	});
});
