// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * JobStore — the durable claim record behind the in-process dispatch loop.
 *
 * This is a DISPATCH-LAYER seam that lives OUTSIDE the engine. It is not a port on
 * `conductRun`, which takes exactly two injected ports (a sink and a store) and gains
 * no third. Dispatch decides *which* run happens *when*; the engine decides what a run
 * does. They meet only at the child process boundary.
 *
 * The contract is claim / heartbeat / reclaim, and it exists from day one because it is
 * the answer to the deploy-coupling objection against running dispatch in the API
 * process: an API restart or crash abandons in-flight runs, and something has to notice
 * and re-drive them.
 *
 * **Reclaim means RERUN, not resume.** Harness sessions are not resumable, the
 * `(branchId, seq)` invariant already permits gappy live delivery, and only the durable
 * event record is complete. So a job whose claim went stale is returned to `pending` and
 * runs again from the top. That is the correct answer, not a compromise.
 *
 * The claim itself is a conditional UPDATE guarded on `status = 'pending'`. Whichever
 * writer's guard still matches wins; every other concurrent claimer sees a zero row
 * count and moves on. This is exclusive on SQLite (single writer) and on Postgres (row
 * lock, then the re-evaluated guard fails). The Postgres `SELECT … FOR UPDATE SKIP
 * LOCKED` driver is a faster implementation of this same contract and is not built here.
 */

export type JobStatus =
	| "pending"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled";

/** A claimed job, as handed to the dispatch loop. */
export interface ClaimedJob {
	id: string;
	kind: string;
	investigationId: string;
	incidentId: string;
	/** JSON-encoded job payload. */
	payload: string;
	priority: number;
	attempts: number;
	maxAttempts: number;
}

export interface JobRecord extends ClaimedJob {
	status: JobStatus;
	claimedBy: string | null;
	claimedAt: Date | null;
	heartbeatAt: Date | null;
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
	maxAttempts: number;
	kind?: string;
}

export interface JobStore {
	/** Insert a claimable job. Returns the row id. */
	enqueue(input: EnqueueJobInput): Promise<string>;

	/**
	 * Atomically take ownership of up to `limit` claimable jobs for `owner`.
	 * Only jobs whose guard still matched at write time are returned, so two
	 * concurrent claimers can never receive the same job.
	 */
	claim(owner: string, limit: number, now?: Date): Promise<ClaimedJob[]>;

	/**
	 * Refresh the claim's proof-of-life. Returns false when the claim was lost
	 * (reclaimed by the sweeper, or the job reached a terminal state) — the caller
	 * must then stop working on it.
	 */
	heartbeat(jobId: string, owner: string, now?: Date): Promise<boolean>;

	/**
	 * Return every job whose claim heartbeat is older than `staleMs` to `pending` so it
	 * RERUNS, unless it has exhausted its attempts — those are failed permanently.
	 * Returns the ids of jobs put back in the claimable pool.
	 */
	reclaimStale(staleMs: number, now?: Date): Promise<string[]>;

	/**
	 * Mark a running job terminal.
	 *
	 * Guarded on the claim owner: a holder whose claim was already reclaimed must not
	 * be able to write a terminal status over the run that replaced it. Returns whether
	 * the write landed.
	 */
	complete(
		jobId: string,
		owner: string,
		status: Extract<JobStatus, "succeeded" | "failed" | "cancelled">,
		error?: string,
	): Promise<boolean>;

	/**
	 * Release a claim back to `pending` with a delay, for a retryable failure.
	 * Returns false when the attempt budget is spent (the job is failed instead) or
	 * when this owner no longer holds the claim.
	 */
	retryLater(
		jobId: string,
		owner: string,
		delayMs: number,
		error: string,
	): Promise<boolean>;

	/** Look a job up by the investigation it belongs to. */
	findByInvestigation(investigationId: string): Promise<JobRecord | null>;

	/**
	 * Cancel a job that has not been claimed yet. Returns false when it is already
	 * running (a claimer won the race) or gone — the caller then falls back to
	 * requesting cancellation of the live run.
	 */
	cancelIfPending(investigationId: string): Promise<boolean>;
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
	maxAttempts: true,
} as const;

function toClaimedJob(row: Record<string, unknown>): ClaimedJob {
	return {
		id: String(row.id),
		kind: String(row.kind),
		investigationId: String(row.investigationId),
		incidentId: String(row.incidentId),
		payload: String(row.payload),
		priority: Number(row.priority),
		attempts: Number(row.attempts),
		maxAttempts: Number(row.maxAttempts),
	};
}

function toJobRecord(row: Record<string, unknown>): JobRecord {
	return {
		...toClaimedJob(row),
		status: row.status as JobStatus,
		claimedBy: (row.claimedBy as string | null) ?? null,
		claimedAt: (row.claimedAt as Date | null) ?? null,
		heartbeatAt: (row.heartbeatAt as Date | null) ?? null,
		finishedAt: (row.finishedAt as Date | null) ?? null,
		lastError: (row.lastError as string | null) ?? null,
		runAt: row.runAt as Date,
		createdAt: row.createdAt as Date,
	};
}

/**
 * The SQLite/Postgres JobStore, over Prisma. One implementation serves both schema
 * trees — nothing here is dialect-specific, which is exactly why the `SKIP LOCKED`
 * driver can arrive later as an optimisation rather than a redesign.
 */
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
				maxAttempts: input.maxAttempts,
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
			const job = toClaimedJob(row);
			const { count } = await this.jobs.updateMany({
				where: { id: job.id, status: "pending" },
				data: {
					status: "running",
					claimedBy: owner,
					claimedAt: now,
					heartbeatAt: now,
					attempts: { increment: 1 },
				},
			});
			// count === 0 ⇒ another claimer got there first. Not an error.
			if (count === 1) claimed.push({ ...job, attempts: job.attempts + 1 });
		}
		return claimed;
	}

	async heartbeat(
		jobId: string,
		owner: string,
		now: Date = new Date(),
	): Promise<boolean> {
		const { count } = await this.jobs.updateMany({
			where: { id: jobId, status: "running", claimedBy: owner },
			data: { heartbeatAt: now },
		});
		return count === 1;
	}

	async reclaimStale(
		staleMs: number,
		now: Date = new Date(),
	): Promise<string[]> {
		const cutoff = new Date(now.getTime() - staleMs);
		const stale = await this.jobs.findMany({
			where: { status: "running", heartbeatAt: { lt: cutoff } },
			select: { ...CLAIMABLE_SELECT, claimedBy: true },
		});

		const reclaimed: string[] = [];
		for (const row of stale) {
			const job = toClaimedJob(row);
			const owner = (row.claimedBy as string | null) ?? null;
			const exhausted = job.attempts >= job.maxAttempts;

			// Guard on the owner we observed as well as the status: if the original holder
			// heartbeated between the read and this write, its claim is alive again and the
			// guard's `heartbeatAt` bound refuses to steal it.
			const { count } = await this.jobs.updateMany({
				where: {
					id: job.id,
					status: "running",
					claimedBy: owner,
					heartbeatAt: { lt: cutoff },
				},
				data: exhausted
					? {
							status: "failed",
							claimedBy: null,
							finishedAt: now,
							lastError: `Abandoned after ${job.attempts} attempt(s) — claim heartbeat went stale`,
						}
					: {
							// Reclaim = RERUN. The row goes back in the claimable pool from the
							// top; the next claimer runs the investigation again rather than
							// trying to resume a harness session that cannot be resumed.
							status: "pending",
							claimedBy: null,
							claimedAt: null,
							heartbeatAt: null,
							runAt: now,
							lastError: "Reclaimed after the claim heartbeat went stale",
						},
			});
			if (count === 1 && !exhausted) reclaimed.push(job.id);
		}
		return reclaimed;
	}

	async complete(
		jobId: string,
		owner: string,
		status: Extract<JobStatus, "succeeded" | "failed" | "cancelled">,
		error?: string,
	): Promise<boolean> {
		// `claimedBy: owner` is the load-bearing guard. Without it a holder whose claim
		// the sweeper already reclaimed could land a terminal write on top of the RERUN
		// that replaced it — two writers on one investigation, which is the exact failure
		// the heartbeat's stand-down rule exists to prevent.
		const { count } = await this.jobs.updateMany({
			where: { id: jobId, status: "running", claimedBy: owner },
			data: {
				status,
				claimedBy: null,
				finishedAt: new Date(),
				...(error !== undefined ? { lastError: error } : {}),
			},
		});
		return count === 1;
	}

	async retryLater(
		jobId: string,
		owner: string,
		delayMs: number,
		error: string,
	): Promise<boolean> {
		const row = await this.jobs.findUnique({
			where: { id: jobId },
			select: CLAIMABLE_SELECT,
		});
		if (!row) return false;
		const job = toClaimedJob(row);
		if (job.attempts >= job.maxAttempts) {
			await this.complete(jobId, owner, "failed", error);
			return false;
		}
		// Same owner guard as `complete`, and the result is reported honestly: a lost
		// claim means someone else already owns the rerun, so this caller must not
		// report that it scheduled one.
		const { count } = await this.jobs.updateMany({
			where: { id: jobId, status: "running", claimedBy: owner },
			data: {
				status: "pending",
				claimedBy: null,
				claimedAt: null,
				heartbeatAt: null,
				runAt: new Date(Date.now() + delayMs),
				lastError: error,
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
}
