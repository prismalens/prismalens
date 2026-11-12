// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
	Inject,
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	type OnModuleDestroy,
	Optional,
} from "@nestjs/common";
import type { HarnessId } from "@prismalens/config/harness";
import {
	AccessLevelSchema,
	AUTO_START_ACCESS_LEVEL,
	type BuiltInJob,
	type InvestigationJobData,
	LIVE_WORKFLOW_STATUSES,
	type Schedule as ScheduleDto,
	type ScheduledRun,
	type ScheduleInput,
	type ScheduleSubject,
	type ScheduleTick as ScheduleTickDto,
	type TickOutcome,
} from "@prismalens/contracts";
import type { Prisma } from "@prismalens/database";
import { HarnessService } from "../../core/harness/harness.service.js";
import { RuntimeLifecycleService } from "../../core/lifecycle/runtime-lifecycle.service.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import {
	CanonicalBusy,
	canonical,
	sameAsDisk,
} from "../../infrastructure/dispatch/folder-lock.js";
import { serviceNotes } from "../../infrastructure/dispatch/investigation-run.js";
import {
	type JobDelegate,
	PrismaJobStore,
	SCHEDULED_KIND,
} from "../../infrastructure/dispatch/job-store.js";
import { shownFullName } from "../repositories/serialize-repository.js";
import { isUnseen } from "../threads/thread-sections.js";
import { SessionLifecycleService } from "../wakes/session-lifecycle.service.js";
import { allowedAsks } from "./allowed-asks.js";
import { type Decision, decide } from "./decide.js";
import {
	cronShape,
	nextSlots,
	type Recurrence,
	recurrenceError,
} from "./recurrence.js";
import { describeRecurrence, dstNote } from "./schedule-text.js";

/** The slice of the lifecycle record a schedule needs (#983): when the host slept or PrismaLens was off. */
export type RuntimeGaps = Pick<
	RuntimeLifecycleService,
	"observe" | "gapCovering"
>;

export const LOOP_MS = 30_000;
export const SCHEDULED_PRIORITY = 5;
export const FAILURES_BEFORE_PAUSE = 3;
const MAX_SCHEDULES = 50;

export class ScheduleError extends Error {
	constructor(
		readonly code:
			| "NOT_FOUND"
			| "CONFLICT"
			| "BAD_REQUEST"
			| "PRECONDITION_FAILED",
		message: string,
	) {
		super(message);
	}
}

type Row = NonNullable<
	Awaited<ReturnType<PrismaService["schedule"]["findUnique"]>>
>;
type Tx = Prisma.TransactionClient;

const STARTING = new Set<TickOutcome>(["started", "late_started", "run_now"]);

/** A Folder project runs only in a thread a person starts (#1020 R26). */
export const FOLDER_REFUSED =
	"A Folder project can't run on a schedule. Start git here first.";

function subjectOf(s: {
	serviceId: string | null;
	repositoryId: string | null;
}): ScheduleSubject {
	return s.repositoryId ? "project" : s.serviceId ? "service" : "none";
}

/** A project folder that now resolves elsewhere, through a link, or cannot be read in time (#1020). */
export const FOLDER_MOVED =
	"The project's folder is not where it was saved. Review it and resume.";

/** What changed, worded for what the schedule is about; the run stays paused until a host resumes it. */
function bindingsChanged(subject: ScheduleSubject, fix: string): string {
	return subject === "project"
		? `The project's code location changed since this schedule was saved. ${fix}`
		: `The service's repositories or notes changed since this schedule was saved. ${fix}`;
}

export function parseRecurrence(json: string): Recurrence {
	const r = JSON.parse(json) as Recurrence & { anchorAt?: string | Date };
	return r.type === "interval"
		? { ...r, anchorAt: new Date(r.anchorAt as string) }
		: r;
}

function toRecurrence(input: ScheduleInput["recurrence"]): Recurrence {
	return input.type === "interval"
		? { ...input, anchorAt: new Date(input.anchorAt) }
		: input;
}

/** Recent runs a schedule counts toward its unread mark. */
const UNREAD_WINDOW = 30;

@Injectable()
export class SchedulesService
	implements OnApplicationBootstrap, OnModuleDestroy
{
	private readonly logger = new Logger(SchedulesService.name);
	private timer: NodeJS.Timeout | null = null;
	/** One evaluation at a time; the interval, writes and Run now all queue here (adversary OBJ-006). */
	private chain: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly prisma: PrismaService,
		private readonly dispatch: DispatchService,
		private readonly harness: HarnessService,
		@Optional()
		@Inject(RuntimeLifecycleService)
		private readonly gaps?: RuntimeGaps,
		@Optional()
		private readonly sessions?: SessionLifecycleService,
	) {}

	onApplicationBootstrap(): void {
		this.timer = setInterval(() => void this.kick(), LOOP_MS);
		this.timer.unref();
		void this.kick();
	}

	onModuleDestroy(): void {
		if (this.timer) clearInterval(this.timer);
	}

	/** Queue one evaluation; resolves when it ran. */
	kick(now?: Date): Promise<void> {
		const run = this.chain.then(() => this.evaluate(now ?? new Date()));
		this.chain = run.catch((error) =>
			this.logger.error("Schedule evaluation failed", error as Error),
		);
		return this.chain.then(() => undefined);
	}

	private serial<T>(work: () => Promise<T>): Promise<T> {
		const run = this.chain.then(work);
		this.chain = run.catch(() => undefined);
		return run;
	}

	async evaluate(now: Date): Promise<void> {
		// Wakes share the pass: a wake missed while PrismaLens was off fires on the boot pass (#1024).
		await this.sessions
			?.process(now)
			.catch((error) =>
				this.logger.error("Wakes were not processed", error as Error),
			);
		await this.expire(now);
		await this.pauseFailing();
		const due = await this.prisma.schedule.findMany({
			where: { enabled: true, nextRunAt: { lte: now } },
		});
		for (const s of due) {
			try {
				await this.evaluateOne(s, now);
			} catch (error) {
				// Its transaction rolled back, so the slot stays due and the next pass retries it.
				this.logger.error(`Schedule ${s.id} was not evaluated`, error as Error);
			}
		}
	}

	private async evaluateOne(s: Row, now: Date): Promise<void> {
		if (!s.nextRunAt) return;
		let observed = false;
		const decision = decide(
			{
				recurrence: parseRecurrence(s.recurrence),
				nextRunAt: s.nextRunAt,
				missedPolicy: s.missedPolicy as "run_once" | "skip",
				catchUpMinutes: s.catchUpMinutes,
			},
			now,
			(at) => {
				if (!observed) this.gaps?.observe(now);
				observed = true;
				return this.gaps?.gapCovering(at) ?? null;
			},
		);
		if (!decision) return;
		let outcome: TickOutcome = decision.outcome;
		let reason: string | null = decision.gap;
		if (STARTING.has(outcome)) {
			const ready = await this.harness.ensureReady(s.harness as HarnessId);
			if (!ready.ready) {
				outcome = "skipped_agent_not_ready";
				reason = ready.reason;
			}
		}
		await this.admit(s, now, { ...decision, outcome, reason }, "tick");
	}

	/**
	 * Cursor, tick, run and job commit together or not at all (adversary OBJ-001). The cursor update
	 * is conditional on the revision read, so an edit or pause that landed first wins (OBJ-006).
	 */
	private async admit(
		s: Row,
		now: Date,
		d: Pick<Decision, "slot" | "missedCount" | "missedOverflow" | "startBy"> & {
			outcome: TickOutcome;
			reason: string | null;
			next?: Date;
		},
		mode: "tick" | "run_now",
	): Promise<ScheduleTickDto | null> {
		// Read outside the transaction: a stalled drive never holds the database (CP4 OBJ-014).
		const moved = STARTING.has(d.outcome) && (await this.folderMoved(s));
		const admitted = await this.prisma.$transaction(async (tx) => {
			if (mode === "tick") {
				const { count } = await tx.schedule.updateMany({
					where: {
						id: s.id,
						revision: s.revision,
						enabled: true,
						nextRunAt: s.nextRunAt,
					},
					data: { nextRunAt: d.next ?? null, lastEvaluatedAt: now },
				});
				if (count === 0) return null;
			} else {
				const { count } = await tx.schedule.updateMany({
					where: { id: s.id, revision: s.revision },
					data: { lastEvaluatedAt: now },
				});
				if (count === 0)
					throw new ScheduleError(
						"CONFLICT",
						"This schedule changed. Reload it and try again.",
					);
			}
			let outcome = d.outcome;
			const reason = d.reason;
			let frozen: Awaited<ReturnType<SchedulesService["freeze"]>> | null = null;
			if (STARTING.has(outcome)) {
				const live = await tx.investigation.findFirst({
					where: {
						scheduleId: s.id,
						status: { in: [...LIVE_WORKFLOW_STATUSES] },
					},
					select: { id: true },
				});
				if (live) {
					if (mode === "run_now")
						throw new ScheduleError(
							"CONFLICT",
							"A run of this schedule is still going.",
						);
					outcome = "skipped_overlap";
				} else {
					frozen = await this.freeze(tx, s);
					const subject = subjectOf(s);
					if (frozen.hash !== s.bindingsHash || frozen.folder || moved) {
						if (mode === "run_now")
							throw new ScheduleError(
								"CONFLICT",
								frozen.folder
									? FOLDER_REFUSED
									: moved
										? FOLDER_MOVED
										: bindingsChanged(subject, "Save it again to confirm."),
							);
						outcome = "skipped_bindings_changed";
						frozen = null;
						await tx.schedule.updateMany({
							where: { id: s.id, revision: s.revision },
							data: {
								enabled: false,
								pausedReason: moved
									? FOLDER_MOVED
									: bindingsChanged(subject, "Review it and resume."),
							},
						});
						await tx.scheduleEvent.create({
							data: {
								scheduleId: s.id,
								action: "paused_by_prismalens",
								after: JSON.stringify({ reason: "bindings_changed" }),
							},
						});
					}
				}
			}
			const tick = await tx.scheduleTick.create({
				data: {
					scheduleId: s.id,
					scheduledFor: d.slot,
					outcome,
					reason,
					missedCount: d.missedCount,
					missedOverflow: d.missedOverflow,
					revision: s.revision,
				},
			});
			if (!frozen) return { tickId: tick.id, investigationId: null };
			const investigationId = await this.createRun(
				tx,
				s,
				frozen.run,
				outcome,
				d.startBy,
			);
			await tx.scheduleTick.update({
				where: { id: tick.id },
				data: { investigationId },
			});
			return { tickId: tick.id, investigationId };
		});
		if (!admitted) return null;
		if (admitted.investigationId)
			this.dispatch.startAdmitted(admitted.investigationId);
		return this.tickDto(admitted.tickId);
	}

	private async createRun(
		tx: Tx,
		s: Row,
		scheduled: ScheduledRun,
		outcome: TickOutcome,
		startBy: Date | null,
	): Promise<string> {
		const accessLevel =
			AccessLevelSchema.safeParse(s.accessLevel).data ??
			AUTO_START_ACCESS_LEVEL;
		// Report off: the saved text is the first message of a chat that owes an answer (#1020).
		const chat = !s.report;
		const run = await tx.investigation.create({
			data: {
				incidentId: null,
				serviceId: s.serviceId,
				repositoryId: s.repositoryId,
				scheduleId: s.id,
				scheduleRevision: s.revision,
				configSnapshot: JSON.stringify({
					...scheduled,
					brief: s.brief,
					harness: s.harness,
					model: s.model,
					effort: s.effort,
				}),
				status: "pending",
				kind: chat ? "chat" : "investigation",
				title: s.name,
				triggerType: "scheduled",
				triggerReason:
					outcome === "run_now" ? "Run now" : `Schedule: ${s.name}`,
				harness: s.harness,
				model: s.model,
				effort: s.effort,
				accessLevel,
			},
			select: { id: true },
		});
		const data: InvestigationJobData = {
			incidentId: null,
			investigationId: run.id,
			scheduled,
			...(chat
				? { kind: "chat" as const, chat: { text: s.brief } }
				: { brief: s.brief }),
			// Wait for me: an ask waits in its thread and notifies, lapsing after ASK_TIMEOUT_MS (#1020).
			unattended: s.whenAsks !== "wait",
			...(s.whenAsks === "wait" ? { waitForAsks: true } : {}),
			startedBy: "schedule",
			accessLevel,
			harness: s.harness as HarnessId,
			...(s.model ? { model: s.model } : {}),
			...(s.effort ? { effort: s.effort } : {}),
		};
		await new PrismaJobStore(tx.job as unknown as JobDelegate).enqueue({
			investigationId: run.id,
			incidentId: null,
			payload: JSON.stringify(data),
			priority: SCHEDULED_PRIORITY,
			kind: SCHEDULED_KIND,
			startBy: outcome === "run_now" ? null : startBy,
		});
		return run.id;
	}

	/**
	 * What the run may read, as values it uses, and their hash (adversary OBJ-003): a service's
	 * bindings and notes, a project's code location (#1020), or nothing for a schedule with no code.
	 */
	private async freeze(
		db: Tx | PrismaService,
		s: Pick<
			Row,
			| "id"
			| "serviceId"
			| "repositoryId"
			| "runbook"
			| "revision"
			| "alwaysAllow"
		>,
	): Promise<{ hash: string; run: ScheduledRun; folder: boolean }> {
		const remembered = allowedAsks(s.alwaysAllow);
		const common = {
			scheduleId: s.id,
			revision: s.revision,
			runbook: s.runbook,
			...(remembered.length ? { alwaysAllow: remembered } : {}),
		};
		if (s.repositoryId) {
			const repo = await db.repository.findUnique({
				where: { id: s.repositoryId },
				select: {
					sourceKind: true,
					url: true,
					fullName: true,
					defaultBranch: true,
					connectionId: true,
					subPath: true,
					plain: true,
				},
			});
			if (!repo)
				throw new ScheduleError("NOT_FOUND", "That project no longer exists.");
			// Agent-facing: a legacy name may hold its address's credential (#1020).
			const name = shownFullName(repo);
			const ref = {
				sourceKind:
					repo.sourceKind === "folder" ? ("folder" as const) : ("url" as const),
				url: repo.url,
				defaultBranch: repo.defaultBranch ?? null,
				subPath: repo.subPath ?? null,
				connectionId: repo.connectionId ?? null,
				serviceName: name,
				...(repo.plain ? { plain: true } : {}),
			};
			return {
				hash: createHash("sha256")
					.update(JSON.stringify({ subject: "project", repos: [ref] }))
					.digest("hex"),
				folder: repo.plain,
				run: {
					...common,
					subject: "project",
					serviceId: null,
					serviceName: "",
					repositoryId: s.repositoryId,
					projectName: name,
					serviceNotes: null,
					repos: [ref],
				},
			};
		}
		if (!s.serviceId)
			return {
				hash: createHash("sha256")
					.update(JSON.stringify({ subject: "none" }))
					.digest("hex"),
				folder: false,
				run: {
					...common,
					subject: "none",
					serviceId: null,
					serviceName: "",
					serviceNotes: null,
					repos: [],
				},
			};
		const service = await db.service.findUnique({
			where: { id: s.serviceId },
			select: {
				id: true,
				name: true,
				metadata: true,
				repositories: {
					orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
					select: {
						subPath: true,
						isPrimary: true,
						repository: {
							select: {
								sourceKind: true,
								url: true,
								defaultBranch: true,
								connectionId: true,
							},
						},
					},
				},
			},
		});
		if (!service)
			throw new ScheduleError("NOT_FOUND", "That service no longer exists.");
		const repos = service.repositories.map((r) => ({
			sourceKind:
				r.repository.sourceKind === "folder"
					? ("folder" as const)
					: ("url" as const),
			url: r.repository.url,
			defaultBranch: r.repository.defaultBranch ?? null,
			subPath: r.subPath ?? null,
			connectionId: r.repository.connectionId ?? null,
			serviceName: service.name,
		}));
		const notes = serviceNotes(service.metadata);
		const hash = createHash("sha256")
			.update(
				JSON.stringify({
					repos,
					primary: service.repositories.map((r) => r.isPrimary),
					notes,
				}),
			)
			.digest("hex");
		const run: ScheduledRun = {
			...common,
			subject: "service",
			serviceId: service.id,
			serviceName: service.name,
			serviceNotes: notes,
			repos,
		};
		return { hash, run, folder: false };
	}

	/** Scheduled jobs no slot took in time end as host-busy, and their tick says so (adversary OBJ-009). */
	private async expire(now: Date): Promise<void> {
		const due = await new PrismaJobStore(
			this.prisma.job as unknown as JobDelegate,
		).scheduledPastDeadline(now);
		for (const job of due) {
			// Job, run and tick settle together, so no pass leaves one without the others (adversary OBJ-013).
			await this.prisma.$transaction(async (tx) => {
				const store = new PrismaJobStore(tx.job as unknown as JobDelegate);
				if (!(await store.expireScheduledJob(job.id, now))) return;
				await tx.investigation.updateMany({
					where: { id: job.investigationId, status: "pending" },
					data: {
						status: "cancelled",
						completedAt: now,
						error:
							"Not started: PrismaLens was busy with other runs until this run's deadline.",
					},
				});
				await tx.scheduleTick.updateMany({
					where: { investigationId: job.investigationId },
					data: { outcome: "expired_host_busy" },
				});
			});
		}
	}

	/** Three failed runs in a row at the current revision pause the schedule; an older revision never counts (OBJ-006). */
	private async pauseFailing(): Promise<void> {
		const enabled = await this.prisma.schedule.findMany({
			where: { enabled: true },
		});
		for (const s of enabled) {
			const ticks = await this.prisma.scheduleTick.findMany({
				where: {
					scheduleId: s.id,
					revision: s.revision,
					investigationId: { not: null },
				},
				orderBy: { scheduledFor: "desc" },
				take: FAILURES_BEFORE_PAUSE + 1,
				select: { investigationId: true },
			});
			const runs = await this.prisma.investigation.findMany({
				where: { id: { in: ticks.map((t) => t.investigationId as string) } },
				select: { id: true, status: true },
			});
			const status = new Map(runs.map((r) => [r.id, r.status]));
			let trailing = 0;
			for (const t of ticks) {
				const st = status.get(t.investigationId as string);
				// A run still going says nothing yet; it neither breaks nor extends the streak (adversary OBJ-015).
				if (st === "pending" || st === "running") continue;
				if (st !== "failed") break;
				trailing++;
			}
			if (
				trailing === s.consecutiveFailures &&
				trailing < FAILURES_BEFORE_PAUSE
			)
				continue;
			const pause = trailing >= FAILURES_BEFORE_PAUSE;
			const { count } = await this.prisma.schedule.updateMany({
				where: { id: s.id, revision: s.revision, enabled: true },
				data: {
					consecutiveFailures: trailing,
					...(pause
						? {
								enabled: false,
								pausedReason: "Paused after three failed runs in a row.",
							}
						: {}),
				},
			});
			if (pause && count === 1)
				await this.prisma.scheduleEvent.create({
					data: {
						scheduleId: s.id,
						action: "paused_by_prismalens",
						after: JSON.stringify({ reason: "failures" }),
					},
				});
		}
	}

	// --- reads ---------------------------------------------------------------

	async list(): Promise<{ schedules: ScheduleDto[]; builtIns: BuiltInJob[] }> {
		const rows = await this.prisma.schedule.findMany({
			orderBy: { createdAt: "asc" },
		});
		return {
			schedules: await Promise.all(rows.map((r) => this.toDto(r))),
			builtIns: await this.builtIns(),
		};
	}

	async get(id: string, cursor: string | undefined, limit: number) {
		const row = await this.prisma.schedule.findUnique({ where: { id } });
		if (!row) throw new ScheduleError("NOT_FOUND", "No such schedule.");
		const ticks = await this.prisma.scheduleTick.findMany({
			where: { scheduleId: id },
			orderBy: [{ scheduledFor: "desc" }, { id: "desc" }],
			take: limit + 1,
			...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
		});
		const page = ticks.slice(0, limit);
		return {
			schedule: await this.toDto(row),
			ticks: await Promise.all(page.map((t) => this.tickDto(t.id))).then(
				(all) => all.filter((t): t is ScheduleTickDto => t !== null),
			),
			nextCursor: ticks.length > limit ? (page.at(-1)?.id ?? null) : null,
		};
	}

	preview(recurrence: ScheduleInput["recurrence"], now = new Date()) {
		const r = toRecurrence(recurrence);
		const error = recurrenceError(r);
		if (error)
			return { description: null, shape: null, next: [], dstNote: null, error };
		return {
			description: describeRecurrence(r),
			shape: r.type === "interval" ? ("interval" as const) : cronShape(r.expr),
			next: nextSlots(r, now, 3).map((d) => d.toISOString()),
			dstNote: dstNote(r, now),
			error: null,
		};
	}

	// --- writes (the controller lets only the host reach these) ----------------

	create(
		input: ScheduleInput,
		deviceId: string | null,
		now = new Date(),
	): Promise<ScheduleDto> {
		return this.serial(async () => {
			const r = this.validRecurrence(input);
			if ((await this.prisma.schedule.count()) >= MAX_SCHEDULES)
				throw new ScheduleError(
					"BAD_REQUEST",
					`PrismaLens keeps at most ${MAX_SCHEDULES} schedules.`,
				);
			const frozen = await this.saveable(input, "", 1, null);
			const row = await this.prisma.$transaction(async (tx) => {
				const created = await tx.schedule.create({
					data: {
						...this.columns(input),
						bindingsHash: frozen.hash,
						nextRunAt: nextSlots(r, now, 1)[0] ?? null,
					},
				});
				await tx.scheduleEvent.create({
					data: {
						scheduleId: created.id,
						action: "created",
						deviceId,
						after: JSON.stringify(input),
					},
				});
				return created;
			});
			return this.toDto(row);
		});
	}

	update(
		id: string,
		revision: number,
		input: ScheduleInput,
		deviceId: string | null,
		now = new Date(),
	) {
		return this.serial(async () => {
			const r = this.validRecurrence(input);
			const before = await this.prisma.schedule.findUnique({ where: { id } });
			if (!before) throw new ScheduleError("NOT_FOUND", "No such schedule.");
			const frozen = await this.saveable(
				input,
				id,
				before.revision + 1,
				before.alwaysAllow,
			);
			const row = await this.prisma.$transaction(async (tx) => {
				const { count } = await tx.schedule.updateMany({
					where: { id, revision },
					data: {
						...this.columns(input),
						bindingsHash: frozen.hash,
						nextRunAt: nextSlots(r, now, 1)[0] ?? null,
						revision: { increment: 1 },
						consecutiveFailures: 0,
						pausedReason: null,
					},
				});
				if (count === 0)
					throw new ScheduleError(
						"CONFLICT",
						"This schedule changed since you opened it. Reload it to see the latest.",
					);
				await tx.scheduleEvent.create({
					data: {
						scheduleId: id,
						action: "edited",
						deviceId,
						before: JSON.stringify(this.inputOf(before)),
						after: JSON.stringify(input),
					},
				});
				return tx.schedule.findUniqueOrThrow({ where: { id } });
			});
			return this.toDto(row);
		});
	}

	setEnabled(
		id: string,
		enabled: boolean,
		deviceId: string | null,
		now = new Date(),
	) {
		return this.serial(async () => {
			const s = await this.prisma.schedule.findUnique({ where: { id } });
			if (!s) throw new ScheduleError("NOT_FOUND", "No such schedule.");
			const frozen = enabled ? await this.freeze(this.prisma, s) : null;
			if (frozen?.folder)
				throw new ScheduleError("BAD_REQUEST", FOLDER_REFUSED);
			if (enabled && (await this.folderMoved(s)))
				throw new ScheduleError("BAD_REQUEST", FOLDER_MOVED);
			const row = await this.prisma.$transaction(async (tx) => {
				await tx.schedule.update({
					where: { id },
					data: {
						enabled,
						revision: { increment: 1 },
						consecutiveFailures: 0,
						pausedReason: null,
						// Resuming confirms the service as it is now, and paused time is not missed (#979).
						...(frozen
							? {
									bindingsHash: frozen.hash,
									nextRunAt:
										nextSlots(parseRecurrence(s.recurrence), now, 1)[0] ?? null,
								}
							: {}),
					},
				});
				await tx.scheduleEvent.create({
					data: {
						scheduleId: id,
						action: enabled ? "resumed" : "paused",
						deviceId,
					},
				});
				return tx.schedule.findUniqueOrThrow({ where: { id } });
			});
			return this.toDto(row);
		});
	}

	runNow(
		id: string,
		deviceId: string | null,
		now = new Date(),
	): Promise<ScheduleTickDto> {
		return this.serial(async () => {
			const s = await this.prisma.schedule.findUnique({ where: { id } });
			if (!s) throw new ScheduleError("NOT_FOUND", "No such schedule.");
			const ready = await this.harness.ensureReady(s.harness as HarnessId);
			if (!ready.ready)
				throw new ScheduleError("PRECONDITION_FAILED", ready.reason);
			const slot = now;
			const tick = await this.oneRunPerInstant(() =>
				this.admit(
					s,
					now,
					{
						slot,
						outcome: "run_now",
						reason: null,
						missedCount: 0,
						missedOverflow: false,
						startBy: null,
					},
					"run_now",
				),
			);
			await this.prisma.scheduleEvent.create({
				data: { scheduleId: id, action: "run_now", deviceId },
			});
			if (!tick)
				throw new ScheduleError(
					"CONFLICT",
					"This schedule changed. Reload it and try again.",
				);
			return tick;
		});
	}

	remove(id: string, deviceId: string | null) {
		return this.serial(async () => {
			const before = await this.prisma.schedule.findUnique({ where: { id } });
			if (!before) throw new ScheduleError("NOT_FOUND", "No such schedule.");
			await this.prisma.$transaction([
				this.prisma.schedule.delete({ where: { id } }),
				this.prisma.scheduleEvent.create({
					data: {
						scheduleId: id,
						action: "deleted",
						deviceId,
						before: JSON.stringify(this.inputOf(before)),
					},
				}),
			]);
			return { ok: true as const };
		});
	}

	// --- helpers -------------------------------------------------------------

	/**
	 * A project schedule on a local folder: true unless the disk still names the saved path
	 * as written (no link, junction or swap), read under the folder-read cap (CP4 OBJ-014).
	 */
	private async folderMoved(s: Pick<Row, "repositoryId">): Promise<boolean> {
		if (!s.repositoryId) return false;
		const repo = await this.prisma.repository.findUnique({
			where: { id: s.repositoryId },
			select: { sourceKind: true, url: true },
		});
		if (repo?.sourceKind !== "folder") return false;
		try {
			const real = await canonical(repo.url);
			return real === null || !sameAsDisk(resolve(repo.url), real);
		} catch (e) {
			// A busy read says nothing about the folder: do not pause on it; the next tick retries.
			if (e instanceof CanonicalBusy) return false;
			throw e;
		}
	}

	/** One subject at most, and never a Folder project; the values a save confirms. */
	private async saveable(
		input: ScheduleInput,
		id: string,
		revision: number,
		alwaysAllow: string | null,
	) {
		if (input.serviceId && input.repositoryId)
			throw new ScheduleError(
				"BAD_REQUEST",
				"Pick a project or a service, not both.",
			);
		const frozen = await this.freeze(this.prisma, {
			id,
			serviceId: input.serviceId,
			repositoryId: input.repositoryId,
			runbook: input.runbook,
			revision,
			alwaysAllow,
		});
		if (frozen.folder) throw new ScheduleError("BAD_REQUEST", FOLDER_REFUSED);
		return frozen;
	}

	/** A second Run now at the same instant hits the tick's unique slot; it is a conflict, not a fault. */
	private async oneRunPerInstant<T>(work: () => Promise<T>): Promise<T> {
		try {
			return await work();
		} catch (error) {
			if ((error as { code?: string }).code === "P2002")
				throw new ScheduleError(
					"CONFLICT",
					"This schedule just ran. Try again in a moment.",
				);
			throw error;
		}
	}

	private validRecurrence(input: ScheduleInput): Recurrence {
		const r = toRecurrence(input.recurrence);
		const error = recurrenceError(r);
		if (error) throw new ScheduleError("BAD_REQUEST", error);
		return r;
	}

	private columns(input: ScheduleInput) {
		return {
			name: input.name,
			serviceId: input.serviceId,
			repositoryId: input.repositoryId,
			runbook: input.runbook,
			brief: input.brief,
			recurrence: JSON.stringify(input.recurrence),
			harness: input.harness,
			model: input.model,
			effort: input.effort,
			accessLevel: input.accessLevel,
			report: input.report,
			whenAsks: input.whenAsks,
			missedPolicy: input.missedPolicy,
			catchUpMinutes: input.catchUpMinutes,
		};
	}

	private inputOf(row: Row): ScheduleInput {
		return {
			name: row.name,
			serviceId: row.serviceId,
			repositoryId: row.repositoryId,
			runbook: row.runbook,
			brief: row.brief,
			recurrence: JSON.parse(row.recurrence),
			harness: row.harness as ScheduleInput["harness"],
			model: row.model,
			effort: row.effort,
			accessLevel: AccessLevelSchema.safeParse(row.accessLevel).data ?? null,
			report: row.report,
			whenAsks: row.whenAsks === "wait" ? "wait" : "decide",
			missedPolicy: row.missedPolicy as ScheduleInput["missedPolicy"],
			catchUpMinutes: row.catchUpMinutes,
		};
	}

	private async toDto(row: Row): Promise<ScheduleDto> {
		const r = parseRecurrence(row.recurrence);
		const [service, repository, last, live, recent] = await Promise.all([
			row.serviceId
				? this.prisma.service.findUnique({
						where: { id: row.serviceId },
						select: { name: true },
					})
				: null,
			row.repositoryId
				? this.prisma.repository.findUnique({
						where: { id: row.repositoryId },
						select: { sourceKind: true, url: true, fullName: true },
					})
				: null,
			this.prisma.scheduleTick.findFirst({
				where: { scheduleId: row.id },
				orderBy: [{ decidedAt: "desc" }, { id: "desc" }],
				select: { id: true },
			}),
			this.prisma.investigation.findFirst({
				where: {
					scheduleId: row.id,
					status: { in: [...LIVE_WORKFLOW_STATUSES] },
				},
				select: { id: true },
			}),
			this.prisma.scheduleTick.findMany({
				where: { scheduleId: row.id, investigationId: { not: null } },
				orderBy: { decidedAt: "desc" },
				take: UNREAD_WINDOW,
				select: { investigationId: true },
			}),
		]);
		const facts = await this.runFacts(
			recent.flatMap((t) => (t.investigationId ? [t.investigationId] : [])),
		);
		return {
			...this.inputOf(row),
			id: row.id,
			subject: subjectOf(row),
			serviceName: service?.name ?? "",
			repositoryName: repository ? shownFullName(repository) : null,
			alwaysAllow: allowedAsks(row.alwaysAllow),
			description: describeRecurrence(r),
			shape: r.type === "interval" ? "interval" : cronShape(r.expr),
			enabled: row.enabled,
			pausedReason: row.pausedReason,
			nextRunAt: row.enabled ? (row.nextRunAt?.toISOString() ?? null) : null,
			lastTick: last ? await this.tickDto(last.id) : null,
			liveRunId: live?.id ?? null,
			unreadRuns: [...facts.values()].filter((f) => f.unseen).length,
			revision: row.revision,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		};
	}

	/** Each run thread's unread mark and its pending usage-limit wake (#1101 category 22). */
	private async runFacts(
		ids: string[],
	): Promise<
		Map<string, { unseen: boolean; limit: { resetsAt: string | null } | null }>
	> {
		const out = new Map<
			string,
			{ unseen: boolean; limit: { resetsAt: string | null } | null }
		>();
		if (!ids.length) return out;
		const [rows, wakes] = await Promise.all([
			this.prisma.investigation.findMany({
				where: { id: { in: ids } },
				select: {
					id: true,
					status: true,
					incidentId: true,
					awaitingApprovalAt: true,
					lastTurnOutcome: true,
					lastVisitedAt: true,
					settledAt: true,
					createdAt: true,
					startedAt: true,
					completedAt: true,
					limitResetsAt: true,
				},
			}),
			this.prisma.threadWake.findMany({
				where: {
					investigationId: { in: ids },
					kind: "limit",
					state: "pending",
				},
				select: { investigationId: true },
			}),
		]);
		const limited = new Set(wakes.map((w) => w.investigationId));
		for (const r of rows) {
			let lastActivityAt = r.createdAt;
			for (const d of [r.startedAt, r.completedAt, r.awaitingApprovalAt])
				if (d && d > lastActivityAt) lastActivityAt = d;
			out.set(r.id, {
				unseen: isUnseen({ ...r, lastActivityAt, incident: null }),
				limit: limited.has(r.id)
					? { resetsAt: r.limitResetsAt?.toISOString() ?? null }
					: null,
			});
		}
		return out;
	}

	private async tickDto(id: string): Promise<ScheduleTickDto | null> {
		const t = await this.prisma.scheduleTick.findUnique({ where: { id } });
		if (!t) return null;
		const run = t.investigationId
			? await this.prisma.investigation.findUnique({
					where: { id: t.investigationId },
					select: {
						id: true,
						status: true,
						summary: true,
						error: true,
						startedAt: true,
						completedAt: true,
						incidentId: true,
						incident: { select: { number: true } },
					},
				})
			: null;
		const facts = run ? (await this.runFacts([run.id])).get(run.id) : undefined;
		return {
			id: t.id,
			scheduledFor: t.scheduledFor.toISOString(),
			decidedAt: t.decidedAt.toISOString(),
			outcome: t.outcome as TickOutcome,
			reason: t.reason,
			missedCount: t.missedCount,
			missedOverflow: t.missedOverflow,
			run: run
				? {
						id: run.id,
						status: run.status as NonNullable<ScheduleTickDto["run"]>["status"],
						summary: run.summary,
						error: run.error,
						startedAt: run.startedAt?.toISOString() ?? null,
						completedAt: run.completedAt?.toISOString() ?? null,
						incidentId: run.incidentId,
						incidentNumber: run.incident?.number ?? null,
						unseen: facts?.unseen ?? false,
						limit: facts?.limit ?? null,
					}
				: null,
		};
	}

	/** Housekeeping PrismaLens runs itself, read-only; its code stays where it lives (#925). */
	private async builtIns(): Promise<BuiltInJob[]> {
		const pull = await this.prisma.setting.findUnique({
			where: { key: "ALERT_PULL" },
		});
		let lastPulledAt: string | null = null;
		try {
			lastPulledAt = pull
				? ((JSON.parse(pull.value) as { lastPulledAt?: string }).lastPulledAt ??
					null)
				: null;
		} catch {
			lastPulledAt = null;
		}
		return [
			{
				id: "workspace-sweep",
				name: "Remove finished run workspaces",
				description: "Your workspace settings decide what is kept",
				cadence: "When PrismaLens starts",
				lastRunAt: null,
				lastResult: null,
				ok: null,
				nextRunAt: null,
			},
			{
				id: "alert-pull",
				name: "Pull alerts from Alertmanager",
				description: "Catches alerts sent while PrismaLens was off",
				cadence: "When PrismaLens starts",
				lastRunAt: lastPulledAt,
				lastResult: null,
				ok: null,
				nextRunAt: null,
			},
		];
	}
}
