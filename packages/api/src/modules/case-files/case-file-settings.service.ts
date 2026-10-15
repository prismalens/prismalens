// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import { CaseFileSettingsSchema } from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";

export const CASE_FILE_SETTING_KEY = "case_file";

/** Leave to start new Case File work, granted while the switch is on. */
export interface Admission {
	/** Runs `write` unless a turn-off has begun since admission; a turn-off waits for one already running. */
	commit<T>(write: () => Promise<T>): Promise<T | null>;
}

/** The Case File experiment's on/off switch; off unless a valid row says otherwise. */
@Injectable()
export class CaseFileSettingsService {
	private readonly onOff = new Set<() => Promise<void>>();
	/** Moves at the start of every turn-off, before the row is written. */
	private offs = 0;
	private readonly writing = new Set<Promise<unknown>>();

	constructor(private readonly prisma: PrismaService) {}

	/** `stop` runs on every turn-off; `set(false)` returns only once each has settled. */
	onDisable(stop: () => Promise<void>): void {
		this.onOff.add(stop);
	}

	/**
	 * Taken before any other await of new work (OBJ-007): the lookups between
	 * this and `commit` may outlast a whole turn-off, so `commit` decides.
	 */
	async admit(): Promise<Admission | null> {
		const at = this.offs;
		if (!(await this.isEnabled()) || at !== this.offs) return null;
		return { commit: (write) => this.commit(at, write) };
	}

	private async commit<T>(
		at: number,
		write: () => Promise<T>,
	): Promise<T | null> {
		if (at !== this.offs) return null;
		const run = write();
		this.writing.add(run);
		try {
			return await run;
		} finally {
			this.writing.delete(run);
		}
	}

	async isEnabled(): Promise<boolean> {
		try {
			const row = await this.prisma.setting.findUnique({
				where: { key: CASE_FILE_SETTING_KEY },
			});
			if (!row) return false;
			const parsed = CaseFileSettingsSchema.safeParse(JSON.parse(row.value));
			return parsed.success && parsed.data.enabled;
		} catch {
			return false;
		}
	}

	async set(enabled: boolean): Promise<void> {
		if (!enabled) this.offs += 1;
		const value = JSON.stringify({ enabled });
		await this.prisma.setting.upsert({
			where: { key: CASE_FILE_SETTING_KEY },
			update: { value, type: "json" },
			create: {
				key: CASE_FILE_SETTING_KEY,
				value,
				type: "json",
				category: "general",
			},
		});
		if (!enabled) {
			await Promise.allSettled([...this.writing]);
			await Promise.allSettled([...this.onOff].map((stop) => stop()));
		}
	}
}
