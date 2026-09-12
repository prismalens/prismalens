// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * JobStore — the durable claim record behind the in-process dispatch loop
 * (0005 §2: one API process, no worker, no reclaim). A `Job` row is claimed
 * exclusively via a conditional UPDATE guarded on `status = 'pending'`; only
 * one caller ever writes it, since dispatch runs inside this one process.
 *
 * An API restart abandons any `running` row — nothing reclaims or reruns it.
 * `DispatchService.onModuleInit` calls {@link JobStore.failRunning} before the
 * loop starts, so an interrupted run is marked failed, never silently retried.
 */

export type JobStatus =
	| "pending"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled";

/** The job columns every dispatch-side view of a row shares. */
export interface JobFields {
	id: string;
	kind: string;
	investigationId: string;
	incidentId: string;
	/** JSON-encoded job payload. */
	payload: string;
	priority: number;
	attempts: number;
}

export type ClaimedJob = JobFields;

export interface JobRecord extends JobFields {
	status: JobStatus;
	claimedBy: string | null;
	claimedAt: Date | null;
	finishedAt: Date | null;
	lastError: string | null;
	runAt: Date;
	createdAt: Date;
}

export interface EnqueueJobInput {
	investigationId: string;
	incidentId: string;
	payload: string;
	/** 1 (critical) … 4 (low). Ordering only — this is not a fairness key. */
	priority: number;
	kind?: string;
}

export interface JobStore {
	/** Insert a claimable job. Returns the row id. */
	enqueue(input: EnqueueJobInput): Promise<string>;

	/**
	 * Atomically take ownership of up to `limit` claimable jobs for `owner`.
	 * Only jobs whose guard still matched at write time are returned, so two
	 * concurrent callers can never receive the same job.
	 */
	claim(owner: string, limit: number, now?: Date): Promise<ClaimedJob[]>;

	/**
	 * Mark a running job terminal. Returns whether the write landed — false
	 * when the row was no longer `running` (e.g. already cancelled).
	 */
	complete(
		jobId: string,
		status: Extract<JobStatus, "succeeded" | "failed" | "cancelled">,
		error?: string,
	): Promise<boolean>;

	/** Look a job up by the investigation it belongs to. */
	findByInvestigation(investigationId: string): Promise<JobRecord | null>;

	/**
	 * Cancel a job that has not been claimed yet. Returns false when it is already
	 * running (a claimer won the race) or gone — the caller then falls back to
	 * requesting cancellation of the live run.
	 */
	cancelIfPending(investigationId: string): Promise<boolean>;

	/**
	 * Cancel a job whose row still says `running` but whose holder is provably gone —
	 * the cancel publish found zero receivers across every grace retry, so no live run
	 * will ever write the terminal state. Returns whether a running row was cancelled.
	 */
	cancelOrphanedRun(investigationId: string): Promise<boolean>;

	/**
	 * Fail every `running` row with `reason`, for the boot-time sweep after an
	 * API restart abandoned whatever was mid-flight. Returns the investigation
	 * ids of every row it failed, so the caller can fail those investigations too.
	 */
	failRunning(reason: string): Promise<string[]>;
}

/** The Prisma delegate surface this store needs. Structural, so tests can fake it. */
export interface JobDelegate {
	create(args: unknown): Promise<{ id: string }>;
	findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
	findUnique(args: unknown): Promise<Record<string, unknown> | null>;
	updateMany(args: unknown): Promise<{ count: number }>;
}

const CLAIMABLE_SELECT = {
	id: true,
	kind: true,
	investigationId: true,
	incidentId: true,
	payload: true,
	priority: true,
	attempts: true,
} as const;

function toJobFields(row: Record<string, unknown>): JobFields {
	return {
		id: String(row.id),
		kind: String(row.kind),
		investigationId: String(row.investigationId),
		incidentId: String(row.incidentId),
		payload: String(row.payload),
		priority: Number(row.priority),
		attempts: Number(row.attempts),
	};
}

function toJobRecord(row: Record<string, unknown>): JobRecord {
	return {
		...toJobFields(row),
		status: row.status as JobStatus,
		claimedBy: (row.claimedBy as string | null) ?? null,
		claimedAt: (row.claimedAt as Date | null) ?? null,
		finishedAt: (row.finishedAt as Date | null) ?? null,
		lastError: (row.lastError as string | null) ?? null,
		runAt: row.runAt as Date,
		createdAt: row.createdAt as Date,
	};
}

/** The SQLite JobStore, over Prisma. */
export class PrismaJobStore implements JobStore {
	constructor(private readonly jobs: JobDelegate) {}

	async enqueue(input: EnqueueJobInput): Promise<string> {
		const created = await this.jobs.create({
			data: {
				kind: input.kind ?? "investigation",
				investigationId: input.investigationId,
				incidentId: input.incidentId,
				payload: input.payload,
				priority: input.priority,
				status: "pending",
				runAt: new Date(),
			},
			select: { id: true },
		});
		return created.id;
	}

	async claim(
		owner: string,
		limit: number,
		now: Date = new Date(),
	): Promise<ClaimedJob[]> {
		if (limit <= 0) return [];

		// Read candidates, then race for each one. The read is advisory — the write's
		// `status: "pending"` guard is what makes the claim exclusive, so a stale
		// candidate list costs a wasted UPDATE, never a double-claim.
		const candidates = await this.jobs.findMany({
			where: { status: "pending", runAt: { lte: now } },
			orderBy: [{ priority: "asc" }, { runAt: "asc" }, { createdAt: "asc" }],
			take: limit,
			select: CLAIMABLE_SELECT,
		});

		const claimed: ClaimedJob[] = [];
		for (const row of candidates) {
			const job = toJobFields(row);
			const { count } = await this.jobs.updateMany({
				where: { id: job.id, status: "pending" },
				data: {
					status: "running",
					claimedBy: owner,
					claimedAt: now,
					attempts: { increment: 1 },
				},
			});
			// count === 0 ⇒ another claimer got there first. Not an error.
			if (count === 1) claimed.push({ ...job, attempts: job.attempts + 1 });
		}
		return claimed;
	}

	async complete(
		jobId: string,
		status: Extract<JobStatus, "succeeded" | "failed" | "cancelled">,
		error?: string,
	): Promise<boolean> {
		const { count } = await this.jobs.updateMany({
			where: { id: jobId, status: "running" },
			data: {
				status,
				claimedBy: null,
				finishedAt: new Date(),
				...(error !== undefined ? { lastError: error } : {}),
			},
		});
		return count === 1;
	}

	async findByInvestigation(
		investigationId: string,
	): Promise<JobRecord | null> {
		const row = await this.jobs.findUnique({ where: { investigationId } });
		return row ? toJobRecord(row) : null;
	}

	async cancelIfPending(investigationId: string): Promise<boolean> {
		const { count } = await this.jobs.updateMany({
			where: { investigationId, status: "pending" },
			data: {
				status: "cancelled",
				claimedBy: null,
				finishedAt: new Date(),
				lastError: "Cancelled before it was claimed",
			},
		});
		return count === 1;
	}

	async cancelOrphanedRun(investigationId: string): Promise<boolean> {
		const { count } = await this.jobs.updateMany({
			where: { investigationId, status: "running" },
			data: {
				status: "cancelled",
				claimedBy: null,
				finishedAt: new Date(),
				lastError: "Cancelled while no run held the claim",
			},
		});
		return count === 1;
	}

	async failRunning(reason: string): Promise<string[]> {
		const running = await this.jobs.findMany({
			where: { status: "running" },
			select: { id: true, investigationId: true },
		});
		if (running.length === 0) return [];

		await this.jobs.updateMany({
			where: { status: "running" },
			data: {
				status: "failed",
				claimedBy: null,
				finishedAt: new Date(),
				lastError: reason,
			},
		});
		return running.map((row) => String(row.investigationId));
	}
}
