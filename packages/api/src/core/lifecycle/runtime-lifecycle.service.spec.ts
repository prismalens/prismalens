// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service.js";
import {
	HEARTBEAT_MS,
	LIFECYCLE_KEY,
	type LifecycleRecord,
	RuntimeLifecycleService,
} from "./runtime-lifecycle.service.js";

const T0 = Date.parse("2026-10-28T08:52:00Z");
const min = 60_000;

function fakePrisma(initial?: LifecycleRecord) {
	const rows = new Map<string, string>();
	if (initial) rows.set(LIFECYCLE_KEY, JSON.stringify(initial));
	return {
		rows,
		stored: () => JSON.parse(rows.get(LIFECYCLE_KEY) ?? "null") as LifecycleRecord,
		setting: {
			findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
				const value = rows.get(where.key);
				return value === undefined ? null : { value };
			}),
			upsert: vi.fn(
				async ({ where, update }: { where: { key: string }; update: { value: string } }) => {
					rows.set(where.key, update.value);
				},
			),
		},
	};
}

/** A wall clock and a monotonic clock the test moves by hand. */
function clocks(start = T0) {
	let wall = start;
	let mono = 1_000;
	return {
		wall: () => new Date(wall),
		mono: () => mono,
		/** Time passes with the machine awake: both clocks move. */
		run(ms: number) {
			wall += ms;
			mono += ms;
		},
		/** The machine sleeps: only the wall clock moves. */
		sleep(ms: number) {
			wall += ms;
		},
	};
}

function boot(prisma: ReturnType<typeof fakePrisma>, c: ReturnType<typeof clocks>) {
	return new RuntimeLifecycleService(
		prisma as unknown as PrismaService,
		c.wall,
		c.mono,
		false,
	);
}

describe("RuntimeLifecycleService", () => {
	it("a first start has no previous run and records itself as alive", async () => {
		const prisma = fakePrisma();
		const c = clocks();
		const svc = boot(prisma, c);
		const seen = vi.fn();
		svc.onRestart(seen);
		await svc.onModuleInit();
		await svc.onApplicationBootstrap();
		expect(seen).toHaveBeenCalledWith({ bootedAt: new Date(T0), previous: null });
		expect(prisma.stored()).toMatchObject({
			startedAt: new Date(T0).toISOString(),
			aliveAt: new Date(T0).toISOString(),
			stoppedAt: null,
			gaps: [],
		});
	});

	it("a crash leaves no stoppedAt: the gap runs from the last heartbeat, not the stop", async () => {
		const prisma = fakePrisma({
			startedAt: new Date(T0 - 60 * min).toISOString(),
			aliveAt: new Date(T0).toISOString(),
			stoppedAt: null,
			gaps: [],
		});
		const c = clocks(T0 + 22 * min);
		const svc = boot(prisma, c);
		const seen = vi.fn();
		svc.onRestart(seen);
		await svc.onModuleInit();
		await svc.onApplicationBootstrap();
		expect(seen).toHaveBeenCalledWith({
			bootedAt: new Date(T0 + 22 * min),
			previous: {
				startedAt: new Date(T0 - 60 * min),
				lastAliveAt: new Date(T0),
				stoppedCleanly: false,
			},
		});
		expect(svc.gapCovering(new Date(T0 + 5 * min))).toEqual({
			kind: "off",
			from: new Date(T0),
			to: new Date(T0 + 22 * min),
		});
		expect(svc.gapCovering(new Date(T0 - 1))).toBeNull();
	});

	it("a clean stop is reported as one", async () => {
		const prisma = fakePrisma();
		const c = clocks();
		const first = boot(prisma, c);
		await first.onModuleInit();
		c.run(30 * min);
		await first.onApplicationShutdown();
		c.run(5 * min);
		const second = boot(prisma, c);
		await second.onModuleInit();
		expect(second.lastRestart()?.previous).toEqual({
			startedAt: new Date(T0),
			lastAliveAt: new Date(T0 + 30 * min),
			stoppedCleanly: true,
		});
	});

	it("writes aliveAt before init returns, so a crash in the first minute does not overstate the gap", async () => {
		const prisma = fakePrisma({
			startedAt: new Date(T0 - 2 * HEARTBEAT_MS).toISOString(),
			aliveAt: new Date(T0 - HEARTBEAT_MS).toISOString(),
			stoppedAt: null,
			gaps: [],
		});
		const c = clocks();
		await boot(prisma, c).onModuleInit();
		expect(prisma.stored().aliveAt).toBe(new Date(T0).toISOString());
	});

	it("a heartbeat that finds the wall clock ran ahead of the monotonic clock records a sleep and publishes Woke", async () => {
		const prisma = fakePrisma();
		const c = clocks();
		const svc = boot(prisma, c);
		const woke = vi.fn();
		svc.onWake(woke);
		await svc.onModuleInit();
		c.run(HEARTBEAT_MS);
		await svc.beat();
		expect(woke).not.toHaveBeenCalled();
		c.sleep(40 * min);
		c.run(1_000);
		await svc.beat();
		expect(woke).toHaveBeenCalledTimes(1);
		const { at, sleptFrom } = woke.mock.calls[0]?.[0] as { at: Date; sleptFrom: Date };
		expect(sleptFrom).toEqual(new Date(T0 + HEARTBEAT_MS));
		expect(at).toEqual(new Date(T0 + HEARTBEAT_MS + 40 * min + 1_000));
		expect(svc.gapCovering(new Date(T0 + 20 * min))?.kind).toBe("asleep");
		expect(prisma.stored().gaps).toHaveLength(1);
	});

	it("a late timer with both clocks moving is a gap only past three intervals", async () => {
		const prisma = fakePrisma();
		const c = clocks();
		const svc = boot(prisma, c);
		const woke = vi.fn();
		svc.onWake(woke);
		await svc.onModuleInit();
		c.run(2 * HEARTBEAT_MS);
		await svc.beat();
		expect(woke).not.toHaveBeenCalled();
		c.run(4 * HEARTBEAT_MS);
		await svc.beat();
		expect(woke).toHaveBeenCalledTimes(1);
	});

	it("a wall clock set backwards is not a gap", async () => {
		const prisma = fakePrisma();
		const c = clocks();
		const svc = boot(prisma, c);
		const woke = vi.fn();
		svc.onWake(woke);
		await svc.onModuleInit();
		c.sleep(-30 * min);
		await svc.beat();
		expect(woke).not.toHaveBeenCalled();
		expect(prisma.stored().gaps).toEqual([]);
	});

	it("a stored aliveAt in the future is clamped to now", async () => {
		const prisma = fakePrisma({
			startedAt: new Date(T0).toISOString(),
			aliveAt: new Date(T0 + 99 * min).toISOString(),
			stoppedAt: null,
			gaps: [],
		});
		const c = clocks(T0 + 10 * min);
		const svc = boot(prisma, c);
		await svc.onModuleInit();
		expect(svc.lastRestart()?.previous?.lastAliveAt).toEqual(new Date(T0 + 10 * min));
		expect(prisma.stored().gaps).toEqual([]);
	});

	it("keeps at most 50 gaps and none older than 14 days", async () => {
		const day = 24 * 60 * min;
		const old = Array.from({ length: 60 }, (_, i) => ({
			kind: "off" as const,
			from: new Date(T0 - (20 - i * 0.3) * day).toISOString(),
			to: new Date(T0 - (20 - i * 0.3) * day + min).toISOString(),
		}));
		const prisma = fakePrisma({
			startedAt: new Date(T0 - min).toISOString(),
			aliveAt: new Date(T0 - min).toISOString(),
			stoppedAt: null,
			gaps: old,
		});
		const svc = boot(prisma, clocks());
		await svc.onModuleInit();
		const gaps = prisma.stored().gaps;
		expect(gaps.length).toBeLessThanOrEqual(50);
		for (const g of gaps) expect(Date.parse(g.to)).toBeGreaterThan(T0 - 14 * day);
		expect(gaps.at(-1)).toMatchObject({ kind: "off", to: new Date(T0).toISOString() });
	});

	it("a throwing handler does not stop the others", async () => {
		const prisma = fakePrisma();
		const svc = boot(prisma, clocks());
		const after = vi.fn();
		svc.onRestart(() => {
			throw new Error("boom");
		});
		svc.onRestart(after);
		await svc.onModuleInit();
		await svc.onApplicationBootstrap();
		expect(after).toHaveBeenCalledTimes(1);
	});

	it("an unreadable record is treated as a first start", async () => {
		const prisma = fakePrisma();
		prisma.rows.set(LIFECYCLE_KEY, "{not json");
		const svc = boot(prisma, clocks());
		await svc.onModuleInit();
		expect(svc.lastRestart()).toEqual({ bootedAt: new Date(T0), previous: null });
	});

	it("the heartbeat timer does not hold the process open", async () => {
		const svc = new RuntimeLifecycleService(
			fakePrisma() as unknown as PrismaService,
			() => new Date(T0),
			() => 0,
		);
		await svc.onModuleInit();
		const { timer } = svc as unknown as { timer: NodeJS.Timeout };
		expect(timer.hasRef()).toBe(false);
		await svc.onApplicationShutdown();
	});
});
