// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Model catalogue: bundled catalogue of models per harness.
 *
 * (1) there is no network fetch, so a model correction waits for a release;
 * (2) therefore the catalogue never rejects a model id — it only annotates one;
 * (3) no cache exists, so `updatedAt` is recorded (it names the catalogue that judged an id) and compared with nothing; if a cache is ever added, `updatedAt` inside the file decides precedence, never fetch time.
 *
 * Adding a model is a JSON edit, never code. Tests use synthetic names, so adding a model never touches a test.
 */

import { z } from "zod";
import { HARNESS_IDS, type HarnessId } from "./harness.js";
import raw from "./model-catalogue.json" with { type: "json" };

export const ModelEntrySchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	status: z.enum(["current", "legacy"]),
	note: z.string().optional(),
});

const HarnessModelsSchema = z.object({
	idFormat: z.string().min(1),
	models: z.array(ModelEntrySchema).superRefine((models, ctx) => {
		const seen = new Set<string>();
		for (let i = 0; i < models.length; i++) {
			const m = models[i];
			if (seen.has(m.id)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Duplicate model id "${m.id}" within harness`,
					path: [i, "id"],
				});
			}
			seen.add(m.id);
		}
	}),
});

export const ModelCatalogueSchema = z.object({
	/** ISO date of the last edit to this file; recorded, never compared (no cache, no fetch). */
	updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	harnesses: z.object(
		Object.fromEntries(HARNESS_IDS.map((id) => [id, HarnessModelsSchema])) as {
			[K in HarnessId]: typeof HarnessModelsSchema;
		},
	),
});

export type ModelEntry = z.infer<typeof ModelEntrySchema>;
export type ModelCatalogue = z.infer<typeof ModelCatalogueSchema>;

/**
 * Throws on an invalid catalogue: a bad bundle fails build and tests, never a run.
 *
 * (1) there is no network fetch, so a model correction waits for a release;
 * (2) therefore the catalogue never rejects a model id — it only annotates one;
 * (3) no cache exists, so `updatedAt` is recorded (it names the catalogue that judged an id) and compared with nothing; if a cache is ever added, `updatedAt` inside the file decides precedence, never fetch time.
 */
export function loadModelCatalogue(input: unknown): ModelCatalogue {
	return ModelCatalogueSchema.parse(input);
}

export const MODEL_CATALOGUE: ModelCatalogue = loadModelCatalogue(raw);

export function catalogueModels(
	harness: HarnessId,
	catalogue: ModelCatalogue = MODEL_CATALOGUE,
): readonly ModelEntry[] {
	return catalogue.harnesses[harness]?.models ?? [];
}

export type ModelAnnotation =
	| { listed: true; entry: ModelEntry; catalogueAt: string }
	| { listed: false; catalogueAt: string }
	/** The catalogue has no entries for this harness, so it says nothing. */
	| { listed: null; catalogueAt: string };

/** Never a verdict on whether the id will work; the harness decides that. */
export function annotateModel(
	harness: HarnessId,
	id: string,
	catalogue: ModelCatalogue = MODEL_CATALOGUE,
): ModelAnnotation {
	const trimmed = id.trim();
	if (trimmed.length === 0) {
		return { listed: null, catalogueAt: catalogue.updatedAt };
	}
	const models = catalogueModels(harness, catalogue);
	if (models.length === 0) {
		return { listed: null, catalogueAt: catalogue.updatedAt };
	}
	const entry = models.find((m) => m.id === trimmed);
	if (entry) {
		return { listed: true, entry, catalogueAt: catalogue.updatedAt };
	}
	return { listed: false, catalogueAt: catalogue.updatedAt };
}
