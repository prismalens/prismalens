// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Detect and report (ADR 0003 §9). The harness is the first registry row on
 * PATH, unless PRISMALENS_HARNESS or the persisted setting pins one.
 * Prismalens never bundles, installs or authenticates a harness.
 */
import {
	Injectable,
	Logger,
	type OnApplicationBootstrap,
} from "@nestjs/common";
import {
	type HarnessSelection,
	listHarnessStatus,
	resolveHarnessSelection,
} from "@prismalens/config";
import {
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
	refuseModel,
} from "@prismalens/config/harness";
import type {
	FavouriteModel,
	HarnessesResponse,
	HarnessStatus,
} from "@prismalens/contracts/schemas";
import { PrismaService } from "../prisma/prisma.service.js";
import { HarnessModelsService } from "./harness-models.service.js";
import { HarnessProbeService } from "./harness-probe.service.js";

/** How long a remembered "ready" stands before a run checks again; "not ready" is never reused (#673 w9). */
export const READY_CHECK_TTL_MS = 24 * 60 * 60 * 1000;

export type Readiness = { ready: true } | { ready: false; reason: string };

type Check = NonNullable<HarnessStatus["checked"]>;

/** A failed check in the words the box, the picker and the Timeline share: "<agent>: <detail>". */
function notReadyReason(id: HarnessId, check: Pick<Check, "detail">): string {
	return `${HARNESS_REGISTRY[id].label}: ${check.detail}`;
}

const SETTING_KEY = "HARNESS";

export interface HarnessSettings {
	/** "auto" or a registry id. PRISMALENS_HARNESS always wins over this. */
	harness: "auto" | HarnessId;
	/** Model id per harness, in that harness's own format; absent means its default. */
	models?: Partial<Record<HarnessId, string>>;
	/** Starred models across agents (R4.2), shown first in the picker. */
	favourites?: FavouriteModel[];
	/** Effort per harness, a value of its `thought_level` option (R4.2). */
	efforts?: Partial<Record<HarnessId, string>>;
	/** The agent's own mode id per harness (#673 w21); absent means the row's default. */
	agentModes?: Partial<Record<HarnessId, string>>;
}

export interface HarnessSettingsPatch {
	harness?: "auto" | HarnessId;
	/** Merged per harness; `null` clears that harness's model. */
	models?: Partial<Record<HarnessId, string | null>>;
	/** Replaces the whole list. */
	favourites?: FavouriteModel[];
	/** Merged per harness; `null` goes back to the harness's own default. */
	efforts?: Partial<Record<HarnessId, string | null>>;
	/** Merged per harness; `null` goes back to the row's default. */
	agentModes?: Partial<Record<HarnessId, string | null>>;
}

/** Keeps only registry ids with a non-empty string; anything else in the stored JSON is dropped (models, efforts and modes alike). */
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
export class HarnessService implements OnApplicationBootstrap {
	private readonly logger = new Logger(HarnessService.name);
	/** One probe per harness at a time: a second caller shares the first's answer. */
	private readonly inFlight = new Map<HarnessId, Promise<Check | null>>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly models: HarnessModelsService = new HarnessModelsService(),
		private readonly probe: HarnessProbeService = new HarnessProbeService(
			models,
		),
	) {}

	/** Check each installed agent once, in the background, so the picker is right on first open. */
	onApplicationBootstrap(): void {
		if (process.env.NODE_ENV === "test") return;
		void this.sweep();
	}

	async sweep(): Promise<void> {
		for (const h of listHarnessStatus()) {
			if (h.installed) await this.checkOnce(h.id as HarnessId);
		}
	}

	/**
	 * Would a run on this agent start? A remembered `answers-acp` under a day
	 * old, else a check now: a remembered failure is checked again, so signing
	 * in takes effect on the next run (#673 w9).
	 */
	async ensureReady(id: HarnessId): Promise<Readiness> {
		const remembered = this.models.checked(id);
		const fresh =
			remembered?.outcome === "answers-acp" &&
			Date.now() - Date.parse(remembered.at) < READY_CHECK_TTL_MS;
		const check = fresh ? remembered : await this.checkOnce(id);
		if (!check)
			return {
				ready: false,
				reason: `${HARNESS_REGISTRY[id].label}: the readiness check did not run`,
			};
		return check.outcome === "answers-acp"
			? { ready: true }
			: { ready: false, reason: notReadyReason(id, check) };
	}

	private checkOnce(id: HarnessId): Promise<Check | null> {
		const running = this.inFlight.get(id);
		if (running) return running;
		const next = this.probe
			.check(id)
			.then(() => this.models.checked(id) ?? null)
			.catch((err: unknown) => {
				this.logger.warn(
					`Readiness check for ${id} failed: ${(err as Error).message}`,
				);
				return null;
			})
			.finally(() => this.inFlight.delete(id));
		this.inFlight.set(id, next);
		return next;
	}

	/** A mode's name as the agent's last check listed it; the id when it listed none (#673 w21). */
	modeName(harness: string | null, modeId: string | null): string | null {
		if (!modeId) return null;
		const id = HARNESS_IDS.find((h) => h === harness);
		const listed = id ? this.models.checked(id)?.modes : null;
		return listed?.find((m) => m.id === modeId)?.name ?? modeId;
	}

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
			const efforts = cleanModels(parsed.efforts);
			const favourites = cleanFavourites(parsed.favourites);
			const agentModes = cleanModels(parsed.agentModes);
			return {
				harness,
				...(Object.keys(models).length ? { models } : {}),
				...(favourites.length ? { favourites } : {}),
				...(Object.keys(efforts).length ? { efforts } : {}),
				...(Object.keys(agentModes).length ? { agentModes } : {}),
			};
		} catch {
			return { harness: "auto" };
		}
	}

	async updateSettings(patch: HarnessSettingsPatch): Promise<HarnessSettings> {
		const current = await this.getSettings();
		const models = cleanModels({ ...current.models, ...patch.models });
		const favourites = cleanFavourites(patch.favourites ?? current.favourites);
		const efforts = cleanModels({ ...current.efforts, ...patch.efforts });
		const agentModes = cleanModels({
			...current.agentModes,
			...patch.agentModes,
		});
		const next: HarnessSettings = {
			harness: patch.harness ?? current.harness,
			...(Object.keys(models).length ? { models } : {}),
			...(favourites.length ? { favourites } : {}),
			...(Object.keys(efforts).length ? { efforts } : {}),
			...(Object.keys(agentModes).length ? { agentModes } : {}),
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
