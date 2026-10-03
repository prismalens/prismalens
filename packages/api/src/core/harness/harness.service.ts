// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Detect and report (ADR 0003 §9). The harness is the first registry row on
 * PATH, unless PRISMALENS_HARNESS or the persisted setting pins one.
 * Prismalens never bundles, installs or authenticates a harness.
 */
import { Injectable } from "@nestjs/common";
import {
	type HarnessSelection,
	listHarnessStatus,
	resolveHarnessSelection,
} from "@prismalens/config";
import {
	HARNESS_IDS,
	type HarnessId,
	refuseModel,
} from "@prismalens/config/harness";
import type {
	FavouriteModel,
	HarnessesResponse,
} from "@prismalens/contracts/schemas";
import { PrismaService } from "../prisma/prisma.service.js";
import { HarnessModelsService } from "./harness-models.service.js";

const SETTING_KEY = "HARNESS";

export interface HarnessSettings {
	/** "auto" or a registry id. PRISMALENS_HARNESS always wins over this. */
	harness: "auto" | HarnessId;
	/** Model id per harness, in that harness's own format; absent means its default. */
	models?: Partial<Record<HarnessId, string>>;
	/** Starred models across agents (R4.2), shown first in the picker. */
	favourites?: FavouriteModel[];
}

export interface HarnessSettingsPatch {
	harness?: "auto" | HarnessId;
	/** Merged per harness; `null` clears that harness's model. */
	models?: Partial<Record<HarnessId, string | null>>;
	/** Replaces the whole list. */
	favourites?: FavouriteModel[];
}

/** Keeps only registry ids with a non-empty string; anything else in the stored JSON is dropped. */
function cleanModels(raw: unknown): Partial<Record<HarnessId, string>> {
	const out: Partial<Record<HarnessId, string>> = {};
	if (!raw || typeof raw !== "object") return out;
	for (const [id, model] of Object.entries(raw)) {
		if (
			HARNESS_IDS.includes(id as HarnessId) &&
			typeof model === "string" &&
			model.trim()
		)
			out[id as HarnessId] = model.trim();
	}
	return out;
}

/** Starred models, deduplicated, each naming a harness this build knows. */
function cleanFavourites(raw: unknown): FavouriteModel[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const out: FavouriteModel[] = [];
	for (const f of raw as Array<Partial<FavouriteModel>>) {
		const model = typeof f?.model === "string" ? f.model.trim() : "";
		if (!model || !HARNESS_IDS.includes(f?.harness as HarnessId)) continue;
		const key = `${f.harness}\u0000${model}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ harness: f.harness as HarnessId, model });
	}
	return out;
}

@Injectable()
export class HarnessService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly models: HarnessModelsService = new HarnessModelsService(),
	) {}

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
			const models = cleanModels(parsed.models);
			const favourites = cleanFavourites(parsed.favourites);
			return {
				harness,
				...(Object.keys(models).length ? { models } : {}),
				...(favourites.length ? { favourites } : {}),
			};
		} catch {
			return { harness: "auto" };
		}
	}

	async updateSettings(patch: HarnessSettingsPatch): Promise<HarnessSettings> {
		const current = await this.getSettings();
		const models = cleanModels({ ...current.models, ...patch.models });
		const favourites = cleanFavourites(patch.favourites ?? current.favourites);
		const next: HarnessSettings = {
			harness: patch.harness ?? current.harness,
			...(Object.keys(models).length ? { models } : {}),
			...(favourites.length ? { favourites } : {}),
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

	/**
	 * Env pin first, then the persisted pin, then auto. A selection whose
	 * harness cannot take the model stored for it is not runnable (#639 rec 4).
	 */
	async resolveSelection(): Promise<HarnessSelection> {
		const settings = await this.getSettings();
		const env = process.env.PRISMALENS_HARNESS?.trim();
		const selection = env
			? resolveHarnessSelection({ envHarness: env, pinSource: "env" })
			: resolveHarnessSelection(
					settings.harness === "auto"
						? {}
						: { envHarness: settings.harness, pinSource: "settings" },
				);
		if (!selection.runnable) return selection;
		const reason = refuseModel(
			selection.harness,
			settings.models?.[selection.harness],
		);
		if (!reason) return selection;
		return {
			runnable: false,
			failure: "model-unsupported",
			reason,
			harness: selection.harness,
			...(selection.pinnedBy ? { pinnedBy: selection.pinnedBy } : {}),
		};
	}

	async getStatus(): Promise<HarnessesResponse> {
		const selection = await this.resolveSelection();
		return {
			harnesses: (() => {
				const catalogue = this.models.catalogue();
				return listHarnessStatus().map((h) => ({
					...h,
					models: this.models.modelsFor(h.id, catalogue),
					checked: this.models.checked(h.id),
				}));
			})(),
			selection: selection.runnable
				? {
						runnable: true,
						harness: selection.harness,
						pinned: !selection.auto,
						pinnedBy: selection.pinnedBy ?? null,
						blockedReason: null,
					}
				: {
						runnable: false,
						harness: selection.harness ?? null,
						// A pin failure (env or persisted) is pinned; only "no-harness" is auto.
						pinned: selection.failure !== "no-harness",
						pinnedBy: selection.pinnedBy ?? null,
						blockedReason: selection.reason,
					},
		};
	}
}
