// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Detect and report (ADR 0003 §9). The harness is whatever verified registry
 * row is on PATH, unless PRISMALENS_HARNESS or the persisted setting pins one.
 * Prismalens never bundles, installs or authenticates a harness.
 */
import { Injectable } from "@nestjs/common";
import {
	type HarnessSelection,
	listHarnessStatus,
	resolveHarnessSelection,
} from "@prismalens/config";
import { HARNESS_IDS, type HarnessId } from "@prismalens/config/harness";
import type { HarnessesResponse } from "@prismalens/contracts/schemas";
import { PrismaService } from "../prisma/prisma.service.js";

const SETTING_KEY = "HARNESS";

export interface HarnessSettings {
	/** "auto" or a registry id. PRISMALENS_HARNESS always wins over this. */
	harness: "auto" | HarnessId;
	/** Model id in the harness's own format; undefined means the harness default. */
	model?: string;
}

@Injectable()
export class HarnessService {
	constructor(private readonly prisma: PrismaService) {}

	async getSettings(): Promise<HarnessSettings> {
		const row = await this.prisma.setting.findUnique({
			where: { key: SETTING_KEY },
		});
		if (!row) return { harness: "auto" };
		try {
			const parsed = JSON.parse(row.value) as Partial<HarnessSettings>;
			const harness =
				parsed.harness === "auto" ||
				HARNESS_IDS.includes(parsed.harness as HarnessId)
					? (parsed.harness as HarnessSettings["harness"])
					: "auto";
			return { harness, ...(parsed.model ? { model: parsed.model } : {}) };
		} catch {
			return { harness: "auto" };
		}
	}

	async updateSettings(
		patch: Partial<HarnessSettings>,
	): Promise<HarnessSettings> {
		const current = await this.getSettings();
		const next: HarnessSettings = {
			harness: patch.harness ?? current.harness,
			...((patch.model ?? current.model)
				? { model: patch.model ?? current.model }
				: {}),
		};
		await this.prisma.setting.upsert({
			where: { key: SETTING_KEY },
			update: { value: JSON.stringify(next), type: "json" },
			create: {
				key: SETTING_KEY,
				value: JSON.stringify(next),
				type: "json",
				category: "ai",
			},
		});
		return next;
	}

	/** Env pin first, then the persisted pin, then auto. */
	async resolveSelection(): Promise<HarnessSelection> {
		const env = process.env.PRISMALENS_HARNESS?.trim();
		if (env) return resolveHarnessSelection({ envHarness: env });
		const settings = await this.getSettings();
		return resolveHarnessSelection(
			settings.harness === "auto" ? {} : { envHarness: settings.harness },
		);
	}

	async getStatus(): Promise<HarnessesResponse> {
		const selection = await this.resolveSelection();
		return {
			harnesses: listHarnessStatus(),
			selection: selection.runnable
				? {
						runnable: true,
						harness: selection.harness,
						pinned: !selection.auto,
						blockedReason: null,
					}
				: {
						runnable: false,
						harness: selection.harness ?? null,
						// A pin failure (env or persisted) is pinned; only "no-harness" is auto.
						pinned: selection.failure !== "no-harness",
						blockedReason: selection.reason,
					},
		};
	}
}
