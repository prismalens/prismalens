// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Background refresh and Check all (#1180 §1.4): every `Check every` minutes, check each
 * installed agent that is on, then read limits. Only agents whose check runs isolated are
 * launched (R1); the others keep their last check and its date.
 */
import {
	Inject,
	Injectable,
	type OnApplicationBootstrap,
	type OnModuleDestroy,
} from "@nestjs/common";
import type { HarnessId } from "@prismalens/config/harness";
import type { HarnessProbeResult } from "@prismalens/contracts/schemas";
import { checkIsolationOf } from "@prismalens/engine";
import type { UsageService } from "../../modules/usage/usage.service.js";
import * as clock from "../clock.js";
import type { HarnessService } from "./harness.service.js";

export const REFRESH_MINUTES = [0, 5, 15, 30, 60] as const;
export type RefreshMinutes = (typeof REFRESH_MINUTES)[number];
/** T3 Code's lightest preset: a pass launches every agent, often on an always-on box. */
export const REFRESH_DEFAULT_MINUTES: RefreshMinutes = 15;
const TICK_MS = 60_000;

/** What a pass reads and starts; the host's harness and usage services supply it. */
export interface RefreshPort {
	/** Installed agents that are on, in the start order. */
	targets(): Promise<HarnessId[]>;
	minutes(): Promise<RefreshMinutes>;
	/** A check that throws `CheckNotIsolatedError` rather than launch un-isolated. */
	check(id: HarnessId): Promise<HarnessProbeResult>;
	readLimits(id: HarnessId): Promise<unknown>;
	/** The agent's check runs isolated, so a pass may start it. */
	safeCheck(id: HarnessId): boolean;
}

export const REFRESH_PORT = Symbol("REFRESH_PORT");

/** A background pass or Check all launches only these. */
export const checksInBackground = (id: HarnessId): boolean =>
	checkIsolationOf(id) !== null;

@Injectable()
export class HarnessRefreshService
	implements OnApplicationBootstrap, OnModuleDestroy
{
	private timer: ReturnType<typeof clock.setInterval> | null = null;
	private running: Promise<void> | null = null;
	/** A pass and Check all take turns, so no agent is checked twice at once. */
	private turn: Promise<unknown> = Promise.resolve();
	private lastPassAt: number | null = null;

	constructor(@Inject(REFRESH_PORT) private readonly port: RefreshPort) {}

	onApplicationBootstrap(): void {
		if (process.env.NODE_ENV === "test") return;
		this.start();
	}

	onModuleDestroy(): void {
		this.stop();
	}

	/** Ticks each minute; a pass starts once `Check every` has passed since the last one began. */
	start(): void {
		if (this.timer) return;
		this.lastPassAt = clock.now();
		this.timer = clock.setInterval(() => void this.tick(), TICK_MS);
		this.timer.unref?.();
	}

	stop(): void {
		if (this.timer) clock.clearInterval(this.timer);
		this.timer = null;
	}

	async tick(): Promise<void> {
		if (this.running) return;
		const minutes = await this.port
			.minutes()
			.catch(() => REFRESH_DEFAULT_MINUTES);
		if (minutes === 0) return;
		const since = clock.now() - (this.lastPassAt ?? 0);
		if (since < minutes * 60_000) return;
		await this.pass().catch(() => undefined);
	}

	/** One pass: checks, then limit reads. Never two at once. */
	pass(): Promise<void> {
		if (this.running) return this.running;
		this.lastPassAt = clock.now();
		const work = this.inTurn(async () => {
			const ids = await this.port.targets();
			await this.checkEach(ids);
			for (const id of ids)
				if (this.port.safeCheck(id))
					await this.port.readLimits(id).catch(() => undefined);
		}).finally(() => {
			this.running = null;
		});
		this.running = work;
		return work;
	}

	/** Check all: one at a time in the start order; an agent with no safe check is not started. */
	checkAll(): Promise<HarnessProbeResult[]> {
		return this.inTurn(async () => this.checkEach(await this.port.targets()));
	}

	private inTurn<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.turn.then(fn, fn);
		this.turn = run.catch(() => undefined);
		return run;
	}

	private async checkEach(ids: HarnessId[]): Promise<HarnessProbeResult[]> {
		const out: HarnessProbeResult[] = [];
		for (const id of ids) {
			if (!this.port.safeCheck(id)) continue;
			// A check that cannot run isolated this time, or fails, leaves the last one standing.
			const result = await this.port.check(id).catch(() => null);
			if (result) out.push(result);
		}
		return out;
	}
}

/** The port on a running host: Settings' agents, the probe and the usage reads. */
export function harnessRefreshPort(
	harness: Pick<HarnessService, "installedIds" | "getSettings" | "check">,
	usage: Pick<UsageService, "readLimits">,
): RefreshPort {
	return {
		async targets() {
			const off = new Set((await harness.getSettings()).off ?? []);
			return (await harness.installedIds()).filter((id) => !off.has(id));
		},
		minutes: async () =>
			(await harness.getSettings()).refreshMinutes ?? REFRESH_DEFAULT_MINUTES,
		check: (id) => harness.check(id, { requireIsolation: true }),
		readLimits: (id) => usage.readLimits(id),
		safeCheck: checksInBackground,
	};
}
