// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Which models the picker suggests per harness (#639). The harness's own list
 * wins: the models it offered at its last readiness check. Otherwise the model
 * catalogue: the bundled one, or `<workspace>/model-catalogue.json` when the
 * operator dropped in a newer one (by its `updatedAt`). Suggestions only; the
 * operator's typed id is never checked against either.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { getAppDataDir } from "@prismalens/config";
import {
	annotateModel,
	catalogueModels,
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
	type ModelCatalogue,
	modelMakerId,
	pickModelCatalogue,
} from "@prismalens/config/harness";
import {
	type HarnessStatus,
	HarnessStatusSchema,
} from "@prismalens/contracts/schemas";
import { z } from "zod";

export const OPERATOR_CATALOGUE_FILE = "model-catalogue.json";

type Check = NonNullable<HarnessStatus["checked"]>;
type OfferedModel = { id: string; name: string; description?: string };

/** The Setting row HARNESS_CHECKS (#1171): each agent's last check, the runtime it ran, and its models. */
export const ChecksSnapshotSchema = z.object({
	v: z.literal(1),
	agents: z.record(
		z.string(),
		z.object({
			check: HarnessStatusSchema.shape.checked.unwrap().unwrap(),
			runtime: z.string(),
			offered: z
				.object({
					at: z.string(),
					models: z.array(
						z.object({
							id: z.string(),
							name: z.string(),
							description: z.string().optional(),
						}),
					),
				})
				.nullable(),
		}),
	),
});
export type ChecksSnapshot = z.infer<typeof ChecksSnapshotSchema>;

@Injectable()
export class HarnessModelsService {
	private readonly logger = new Logger(HarnessModelsService.name);
	private readonly offered = new Map<
		HarnessId,
		{ at: string; models: OfferedModel[] }
	>();
	private lastWarning: string | undefined;

	/** Where the operator's drop-in lives; a field so a test can point it elsewhere. */
	workspaceDir: () => string = getAppDataDir;

	private readonly checks = new Map<
		HarnessId,
		NonNullable<HarnessStatus["checked"]>
	>();
	/** The runtime key each kept check ran under (#1171). */
	private readonly runtimes = new Map<HarnessId, string>();

	/** Remember what a readiness check saw the harness offer. An empty list forgets. */
	remember(id: HarnessId, models: OfferedModel[] | undefined) {
		if (models?.length)
			this.offered.set(id, { at: new Date().toISOString(), models });
		else this.offered.delete(id);
	}

	/** What the check read from the harness itself: its current model, effort option and image capability. */
	rememberCheck(
		id: HarnessId,
		facts: Omit<
			Check,
			| "at"
			| "modes"
			| "efforts"
			| "sandbox"
			| "version"
			| "companionVersion"
			| "account"
			| "signInMethods"
			| "lastTry"
		> &
			Partial<
				Pick<
					Check,
					| "modes"
					| "efforts"
					| "sandbox"
					| "version"
					| "companionVersion"
					| "account"
					| "signInMethods"
				>
			>,
		runtime = "",
	) {
		this.checks.set(id, {
			at: new Date().toISOString(),
			version: null,
			companionVersion: null,
			modes: null,
			efforts: null,
			sandbox: null,
			account: null,
			...facts,
			lastTry: null,
		});
		this.runtimes.set(id, runtime);
	}

	/** A later check that did not answer: the pass stands, with the try beside it. */
	keepWithTry(id: HarnessId, lastTry: NonNullable<Check["lastTry"]>): void {
		const kept = this.checks.get(id);
		if (kept) this.checks.set(id, { ...kept, lastTry });
	}

	/** Drops what the last check saw, after a runtime field changed what the next run starts (#907). */
	forget(id: HarnessId): void {
		this.offered.delete(id);
		this.checks.delete(id);
		this.runtimes.delete(id);
	}

	/** Every kept check with its runtime and offered models, for the HARNESS_CHECKS row. */
	snapshot(): ChecksSnapshot {
		const agents: ChecksSnapshot["agents"] = {};
		for (const [id, check] of this.checks)
			agents[id] = {
				check,
				runtime: this.runtimes.get(id) ?? "",
				offered: this.offered.get(id) ?? null,
			};
		return { v: 1, agents };
	}

	/** Loads a snapshot, keeping only the entries whose runtime is still the agent's current one. */
	restore(
		snapshot: ChecksSnapshot,
		currentRuntime: (id: HarnessId) => string | null,
	): void {
		for (const [key, entry] of Object.entries(snapshot.agents)) {
			const id = HARNESS_IDS.find((h) => h === key);
			if (!id || currentRuntime(id) !== entry.runtime) continue;
			this.checks.set(id, entry.check);
			this.runtimes.set(id, entry.runtime);
			if (entry.offered) this.offered.set(id, entry.offered);
		}
	}

	/** Null until a readiness check has answered for this harness. */
	checked(id: HarnessId): HarnessStatus["checked"] {
		return this.checks.get(id) ?? null;
	}

	/** Read per call, so an edited drop-in applies without a restart. */
	catalogue(): ModelCatalogue {
		const path = join(this.workspaceDir(), OPERATOR_CATALOGUE_FILE);
		let candidate: unknown;
		if (existsSync(path)) {
			try {
				candidate = JSON.parse(readFileSync(path, "utf8"));
			} catch (err) {
				candidate = `unreadable: ${(err as Error).message}`;
			}
		}
		const picked = pickModelCatalogue(candidate);
		if (picked.warning && picked.warning !== this.lastWarning)
			this.logger.warn(`${path}: ${picked.warning}`);
		this.lastWarning = picked.warning;
		return picked.catalogue;
	}

	modelsFor(
		id: HarnessId,
		catalogue = this.catalogue(),
	): HarnessStatus["models"] {
		const offered = this.offered.get(id);
		const vendor = HARNESS_REGISTRY[id].vendor;
		if (offered)
			return {
				source: "harness",
				asOf: offered.at,
				entries: offered.models.map((m) => {
					const note = annotateModel(catalogue, id, m.id);
					return {
						...m,
						status: note.known ? note.entry.status : null,
						maker: modelMakerId(catalogue, id, m.id, vendor),
					};
				}),
			};
		return {
			source: "catalogue",
			asOf: catalogue.updatedAt,
			entries: catalogueModels(catalogue, id).map((m) => ({
				id: m.id,
				name: m.name,
				status: m.status,
				maker: m.maker ?? vendor ?? null,
			})),
		};
	}
}
