// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * JobStore contract tests: claim exclusivity and the terminal transitions
 * (0005 §2 — one process, no heartbeat, no reclaim).
 *
 * These run against an in-memory delegate that models the ONE property the claim
 * algorithm depends on — a conditional UPDATE either matches its guard and writes, or
 * matches nothing and reports zero rows. That is what SQLite gives, and it is what makes
 * a claim exclusive without `SKIP LOCKED`.
 *
 * The delegate yields to the microtask queue inside every operation so two claimers
 * genuinely interleave. A sequential test would prove nothing: the guard would trivially
 * hold because there is no second writer in flight.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	type EnqueueJobInput,
	type JobDelegate,
	PrismaJobStore,
} from "./job-store.js";

type Row = Record<string, unknown>;

/**
 * A minimal in-memory stand-in for the Prisma `job` delegate.
 *
 * Only what the store uses is implemented — equality/`lte` filters, ordering, `take`, and
 * `{ increment }`. Every method awaits before mutating, so concurrent callers interleave
 * between their read and their write, which is exactly the window a claim race lives in.
 */
class FakeJobDelegate implements JobDelegate {
	rows: Row[] = [];
	private seq = 0;
	/** How many updateMany calls found no matching row (i.e. lost a race). */
	missedUpdates = 0;

	async create(args: unknown): Promise<{ id: string }> {
		await Promise.resolve();
		const data = (args as { data: Row }).data;
		const id = `job-${++this.seq}`;
		this.rows.push({
			id,
			kind: "investigation",
			priority: 3,
			status: "pending",
			attempts: 0,
			runAt: new Date(0),
			claimedBy: null,
			claimedAt: null,
			finishedAt: null,
			lastError: null,
			createdAt: new Date(this.seq),
			...data,
		});
		return { id };
	}

	async findMany(args: unknown): Promise<Row[]> {
		await Promise.resolve();
		const a = args as {
			where?: Row;
			orderBy?: Array<Record<string, "asc" | "desc">>;
			take?: number;
		};
		let out = this.rows.filter((r) => matches(r, a.where ?? {}));
		for (const clause of [...(a.orderBy ?? [])].reverse()) {
			const [key, dir] = Object.entries(clause)[0] as [string, "asc" | "desc"];
			out = [...out].sort((x, y) => cmp(x[key], y[key]) * (dir === "asc" ? 1 : -1));
		}
		return a.take != null ? out.slice(0, a.take) : out;
	}

	async findUnique(args: unknown): Promise<Row | null> {
		await Promise.resolve();
		const where = (args as { where: Row }).where;
		return this.rows.find((r) => matches(r, where)) ?? null;
	}

	async updateMany(args: unknown): Promise<{ count: number }> {
		// Yield BEFORE evaluating the guard: this is the interleaving point that lets a
		// competing claimer land its write between our read and ours.
		await Promise.resolve();
		const a = args as { where: Row; data: Row };
		const targets = this.rows.filter((r) => matches(r, a.where));
		if (targets.length === 0) {
			this.missedUpdates++;
			return { count: 0 };
		}
		for (const row of targets) {
			for (const [key, value] of Object.entries(a.data)) {
				if (
					value &&
					typeof value === "object" &&
					"increment" in (value as Row)
				) {
					row[key] = Number(row[key]) + Number((value as Row).increment);
				} else {
					row[key] = value;
				}
			}
		}
		return { count: targets.length };
	}
}

function matches(row: Row, where: Row): boolean {
	return Object.entries(where).every(([key, want]) => {
		const got = row[key];
		if (want && typeof want === "object" && !(want instanceof Date)) {
			const w = want as Record<string, unknown>;
			if ("lt" in w) return got != null && cmp(got, w.lt) < 0;
			if ("lte" in w) return got != null && cmp(got, w.lte) <= 0;
			if ("in" in w) return (w.in as unknown[]).includes(got);
		}
		return got === want || cmp(got, want) === 0;
	});
}

function cmp(a: unknown, b: unknown): number {
	if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
	if (typeof a === "number" && typeof b === "number") return a - b;
	if (a === b) return 0;
	return String(a) < String(b) ? -1 : 1;
}

/**
 * A time base comfortably AFTER the wall clock the store stamps `runAt` with, so a job
 * enqueued in this test is already claimable at `at(0)` and every later offset is
 * unambiguous.
 */
const T0 = new Date(Date.now() + 60_000);
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

function job(n: number, overrides: Partial<EnqueueJobInput> = {}) {
	return {
		investigationId: `inv-${n}`,
		incidentId: `inc-${n}`,
		payload: JSON.stringify({ investigationId: `inv-${n}` }),
		priority: 3,
		...overrides,
	};
}

describe("PrismaJobStore", () => {
	let delegate: FakeJobDelegate;
	let store: PrismaJobStore;

	beforeEach(() => {
		delegate = new FakeJobDelegate();
		store = new PrismaJobStore(delegate);
	});

	describe("claim exclusivity", () => {
		it("two CONCURRENT claimers never receive the same job", async () => {
			for (let n = 1; n <= 6; n++) await store.enqueue(job(n));

			// Both claimers ask for every job at once, so their candidate reads overlap
			// completely. Only the guard can keep them apart.
			const [a, b] = await Promise.all([
				store.claim("owner-a", 6),
				store.claim("owner-b", 6),
			]);

			const idsA = a.map((j) => j.id);
			const idsB = b.map((j) => j.id);
			const overlap = idsA.filter((id) => idsB.includes(id));

			expect(overlap).toEqual([]);
			expect(new Set([...idsA, ...idsB]).size).toBe(idsA.length + idsB.length);
			// Every job goes to exactly one owner, and all six are claimed.
			expect(idsA.length + idsB.length).toBe(6);
			// The loser's guard actually fired — proof the race was exercised, not dodged.
			expect(delegate.missedUpdates).toBeGreaterThan(0);
			for (const row of delegate.rows) {
				expect(row.status).toBe("running");
				expect(row.attempts).toBe(1);
			}
		});

		it("five concurrent claimers still partition the pool exactly once", async () => {
			for (let n = 1; n <= 10; n++) await store.enqueue(job(n));

			const results = await Promise.all(
				["a", "b", "c", "d", "e"].map((o) => store.claim(`owner-${o}`, 10)),
			);

			const all = results.flat().map((j) => j.id);
			expect(all).toHaveLength(10);
			expect(new Set(all).size).toBe(10);
		});

		it("claims in priority order, and never beyond the requested limit", async () => {
			await store.enqueue(job(1, { priority: 4 }));
			await store.enqueue(job(2, { priority: 1 }));
			await store.enqueue(job(3, { priority: 2 }));

			const claimed = await store.claim("owner", 2);

			expect(claimed).toHaveLength(2);
			expect(claimed.map((j) => j.investigationId)).toEqual(["inv-2", "inv-3"]);
		});
	});

	describe("terminal transitions", () => {
		it("cancelIfPending cancels an unclaimed job", async () => {
			await store.enqueue(job(1));

			expect(await store.cancelIfPending("inv-1")).toBe(true);
			expect(delegate.rows[0].status).toBe("cancelled");
		});

		it("cancelIfPending refuses a job that was already claimed", async () => {
			await store.enqueue(job(1));
			await store.claim("owner-a", 1);

			expect(await store.cancelIfPending("inv-1")).toBe(false);
			expect(delegate.rows[0].status).toBe("running");
		});

		it("cancelOrphanedRun cancels a claimed job whose holder is gone", async () => {
			await store.enqueue(job(1));
			await store.claim("owner-a", 1, at(0));

			expect(await store.cancelOrphanedRun("inv-1")).toBe(true);
			expect(delegate.rows[0].status).toBe("cancelled");
		});

		it("cancelOrphanedRun leaves an unclaimed job alone", async () => {
			await store.enqueue(job(1));

			expect(await store.cancelOrphanedRun("inv-1")).toBe(false);
			expect(delegate.rows[0].status).toBe("pending");
		});

		it("complete records the terminal status and releases the claim", async () => {
			const id = await store.enqueue(job(1));
			await store.claim("owner-a", 1);

			expect(await store.complete(id, "succeeded")).toBe(true);

			expect(delegate.rows[0].status).toBe("succeeded");
			expect(delegate.rows[0].claimedBy).toBeNull();
		});

		it("complete refuses a job that is not running", async () => {
			const id = await store.enqueue(job(1));

			expect(await store.complete(id, "succeeded")).toBe(false);
			expect(delegate.rows[0].status).toBe("pending");
		});
	});

	describe("failRunning", () => {
		it("fails every running row with the given reason and returns their investigation ids", async () => {
			await store.enqueue(job(1));
			await store.enqueue(job(2));
			await store.enqueue(job(3));
			await store.claim("owner-a", 2); // job-1 and job-2 go running; job-3 stays pending

			const failed = await store.failRunning("API restarted while the run was in flight");

			expect(failed.sort()).toEqual(["inv-1", "inv-2"]);
			expect(delegate.rows[0].status).toBe("failed");
			expect(delegate.rows[1].status).toBe("failed");
			expect(delegate.rows[0].claimedBy).toBeNull();
			expect(String(delegate.rows[0].lastError)).toContain("restarted");
			// The still-pending job is untouched.
			expect(delegate.rows[2].status).toBe("pending");
		});

		it("returns an empty array when nothing is running", async () => {
			await store.enqueue(job(1));

			expect(await store.failRunning("reason")).toEqual([]);
			expect(delegate.rows[0].status).toBe("pending");
		});
	});
});
