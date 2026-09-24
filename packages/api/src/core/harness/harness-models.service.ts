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
	type HarnessId,
	type ModelCatalogue,
	pickModelCatalogue,
} from "@prismalens/config/harness";
import type { HarnessStatus } from "@prismalens/contracts/schemas";

export const OPERATOR_CATALOGUE_FILE = "model-catalogue.json";

@Injectable()
export class HarnessModelsService {
	private readonly logger = new Logger(HarnessModelsService.name);
	private readonly offered = new Map<
		HarnessId,
		{ at: string; models: { id: string; name: string }[] }
	>();
	private lastWarning: string | undefined;

	/** Where the operator's drop-in lives; a field so a test can point it elsewhere. */
	workspaceDir: () => string = getAppDataDir;

	/** Remember what a readiness check saw the harness offer. An empty list forgets. */
	remember(id: HarnessId, models: { id: string; name: string }[] | undefined) {
		if (models?.length)
			this.offered.set(id, { at: new Date().toISOString(), models });
		else this.offered.delete(id);
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
		if (offered)
			return {
				source: "harness",
				asOf: offered.at,
				entries: offered.models.map((m) => {
					const note = annotateModel(catalogue, id, m.id);
					return { ...m, status: note.known ? note.entry.status : null };
				}),
			};
		return {
			source: "catalogue",
			asOf: catalogue.updatedAt,
			entries: catalogueModels(catalogue, id).map(({ id, name, status }) => ({
				id,
				name,
				status,
			})),
		};
	}
}
