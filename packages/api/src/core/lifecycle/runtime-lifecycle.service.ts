// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { performance } from "node:perf_hooks";
import {
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	type OnApplicationShutdown,
	type OnModuleInit,
} from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service.js";

export const LIFECYCLE_KEY = "runtime.lifecycle";
export const HEARTBEAT_MS = 60_000;
/** Wall time that ran ahead of monotonic time by this much was a suspend. */
const SLEEP_MS = 2 * 60_000;
const MAX_GAPS = 50;
const GAP_DAYS_MS = 14 * 24 * 60 * 60_000;

export type GapKind = "off" | "asleep";
export interface Gap {
	kind: GapKind;
	from: Date;
	to: Date;
}
interface StoredGap {
	kind: GapKind;
	from: string;
	to: string;
}
export interface LifecycleRecord {
	startedAt: string;
	aliveAt: string;
	stoppedAt: string | null;
	gaps: StoredGap[];
}
export interface Restarted {
	bootedAt: Date;
	previous: {
		startedAt: Date;
		lastAliveAt: Date;
		stoppedCleanly: boolean;
	} | null;
}
export interface Woke {
	at: Date;
	sleptFrom: Date;
}

/**
 * The one "PrismaLens has started again" signal: when this process last ran,
 * whether it stopped cleanly, and which recent windows it was off or asleep.
 * Auto-resume (#981) and scheduled tasks (#979) both read it.
 */
@Injectable()
export class RuntimeLifecycleService
	implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown
{
	private readonly logger = new Logger(RuntimeLifecycleService.name);
	private readonly restartHandlers: ((r: Restarted) => unknown)[] = [];
	private readonly wakeHandlers: ((w: Woke) => unknown)[] = [];
	private restarted: Restarted | null = null;
	private gaps: Gap[] = [];
	private startedAt = new Date(0);
	private last = { wall: 0, mono: 0 };
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly prisma: PrismaService,
		private readonly now: () => Date = () => new Date(),
		private readonly monotonic: () => number = () => performance.now(),
		private readonly heartbeat = true,
	) {}

	/** Runs once per boot, after every module's init (so after dispatch has settled its leftover runs). */
	onRestart(handler: (r: Restarted) => unknown): void {
		this.restartHandlers.push(handler);
	}

	onWake(handler: (w: Woke) => unknown): void {
		this.wakeHandlers.push(handler);
	}

	lastRestart(): Restarted | null {
		return this.restarted;
	}

	/** The off or asleep window holding `at`, from memory; null when PrismaLens was running then. */
	gapCovering(at: Date): Gap | null {
		const t = at.getTime();
		return (
			this.gaps.find((g) => g.from.getTime() <= t && t < g.to.getTime()) ?? null
		);
	}

	async onModuleInit(): Promise<void> {
		const booted = this.now();
		const prev = await this.read();
		const previous = prev
			? {
					startedAt: new Date(prev.startedAt),
					lastAliveAt: new Date(
						Math.min(Date.parse(prev.aliveAt), booted.getTime()),
					),
					stoppedCleanly: prev.stoppedAt !== null,
				}
			: null;
		this.gaps = (prev?.gaps ?? []).map((g) => ({
			kind: g.kind,
			from: new Date(g.from),
			to: new Date(g.to),
		}));
		if (previous && previous.lastAliveAt < booted)
			this.addGap({ kind: "off", from: previous.lastAliveAt, to: booted });
		this.restarted = { bootedAt: booted, previous };
		this.startedAt = booted;
		this.last = { wall: booted.getTime(), mono: this.monotonic() };
		// Awaited, so a crash in the first minute leaves this boot's time, not the last run's.
		await this.write(null);
		if (this.heartbeat) {
			this.timer = setInterval(() => void this.beat(), HEARTBEAT_MS);
			this.timer.unref();
		}
	}

	async onApplicationBootstrap(): Promise<void> {
		if (!this.restarted) return;
		await this.publish(this.restartHandlers, this.restarted, "restart");
	}

	async onApplicationShutdown(): Promise<void> {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		const at = this.now();
		this.last = { wall: at.getTime(), mono: this.monotonic() };
		await this.write(at);
		// Prisma's own destroy hook has already disconnected; this write reconnected,
		// and an open SQLite handle blocks deleting the data dir on Windows.
		await this.prisma.$disconnect?.().catch(() => undefined);
	}

	/** One heartbeat; public so tests drive it without timers. */
	async beat(): Promise<void> {
		const wall = this.now().getTime();
		const mono = this.monotonic();
		const dWall = wall - this.last.wall;
		const dMono = mono - this.last.mono;
		const from = new Date(this.last.wall);
		this.last = { wall, mono };
		// A clock set backwards is a clock change, not a gap.
		if (dWall > 3 * HEARTBEAT_MS || dWall - dMono > SLEEP_MS) {
			const woke = { at: new Date(wall), sleptFrom: from };
			this.addGap({ kind: "asleep", from, to: woke.at });
			await this.write(null);
			await this.publish(this.wakeHandlers, woke, "wake");
			return;
		}
		await this.write(null);
	}

	private addGap(gap: Gap): void {
		const floor = gap.to.getTime() - GAP_DAYS_MS;
		this.gaps = [...this.gaps, gap]
			.filter((g) => g.to.getTime() > floor)
			.slice(-MAX_GAPS);
	}

	private async publish<T>(
		handlers: ((v: T) => unknown)[],
		value: T,
		what: string,
	): Promise<void> {
		for (const handler of handlers) {
			try {
				await handler(value);
			} catch (e) {
				this.logger.warn(`A ${what} handler failed: ${(e as Error).message}`);
			}
		}
	}

	private async read(): Promise<LifecycleRecord | null> {
		try {
			const row = await this.prisma.setting.findUnique({
				where: { key: LIFECYCLE_KEY },
			});
			if (!row) return null;
			const parsed = JSON.parse(row.value) as Partial<LifecycleRecord>;
			if (!parsed.startedAt || !parsed.aliveAt) return null;
			return {
				startedAt: parsed.startedAt,
				aliveAt: parsed.aliveAt,
				stoppedAt: parsed.stoppedAt ?? null,
				gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
			};
		} catch (e) {
			this.logger.warn(`Could not read the lifecycle record: ${String(e)}`);
			return null;
		}
	}

	private async write(stoppedAt: Date | null): Promise<void> {
		const value: LifecycleRecord = {
			startedAt: this.startedAt.toISOString(),
			aliveAt: new Date(this.last.wall).toISOString(),
			stoppedAt: stoppedAt?.toISOString() ?? null,
			gaps: this.gaps.map((g) => ({
				kind: g.kind,
				from: g.from.toISOString(),
				to: g.to.toISOString(),
			})),
		};
		try {
			await this.prisma.setting.upsert({
				where: { key: LIFECYCLE_KEY },
				update: { value: JSON.stringify(value), type: "json" },
				create: {
					key: LIFECYCLE_KEY,
					value: JSON.stringify(value),
					type: "json",
					category: "general",
				},
			});
		} catch (e) {
			this.logger.warn(`Could not write the lifecycle record: ${String(e)}`);
		}
	}
}
