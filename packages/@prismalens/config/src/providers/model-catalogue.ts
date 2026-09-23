// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The model catalogue (#639): which model ids prismalens knows per harness, as
 * data. The t3code shape minus the fetch: a bundled file ships with every
 * release, an operator's copy may replace it, `updatedAt` inside the file
 * decides which one wins, and an invalid file keeps the last good one. There
 * is no network fetch: a self-hosted install never calls our repo at runtime.
 *
 * The catalogue annotates, it never rejects: a model id it does not know is
 * passed through as typed, and a harness's own list (ACP `configOptions`,
 * category `model`) wins wherever the harness offers one.
 */
import { z } from "zod";
import bundled from "./model-catalogue.json" with { type: "json" };

/** `current` or `legacy`; any other word a newer file uses is kept as written. */
const ModelEntrySchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	status: z.string().min(1),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

const ModelCatalogueSchema = z.object({
	version: z.literal(1),
	updatedAt: z.iso.datetime({ offset: true }),
	harnesses: z.record(
		z.string(),
		z.object({ models: z.array(ModelEntrySchema) }),
	),
});
export type ModelCatalogue = z.infer<typeof ModelCatalogueSchema>;

/** The catalogue, or null with the reason when `raw` is not one. Unknown keys are dropped, never fatal. */
export function parseModelCatalogue(
	raw: unknown,
): { catalogue: ModelCatalogue } | { error: string } {
	const parsed = ModelCatalogueSchema.safeParse(raw);
	if (parsed.success) return { catalogue: parsed.data };
	const issue = parsed.error.issues[0];
	return {
		error: `${issue?.path.join(".") || "catalogue"}: ${issue?.message ?? "invalid"}`,
	};
}

export const BUNDLED_MODEL_CATALOGUE: ModelCatalogue = (() => {
	const parsed = parseModelCatalogue(bundled);
	if ("error" in parsed)
		throw new Error(`bundled model catalogue is invalid: ${parsed.error}`);
	return parsed.catalogue;
})();

/**
 * The newer of the bundled catalogue and a candidate copy, by `updatedAt`, not
 * by which was read last. An invalid candidate keeps the bundled one and says why.
 */
export function pickModelCatalogue(
	candidate: unknown,
	base: ModelCatalogue = BUNDLED_MODEL_CATALOGUE,
): {
	catalogue: ModelCatalogue;
	source: "bundled" | "operator";
	warning?: string;
} {
	if (candidate === undefined) return { catalogue: base, source: "bundled" };
	const parsed = parseModelCatalogue(candidate);
	if ("error" in parsed)
		return {
			catalogue: base,
			source: "bundled",
			warning: `model catalogue ignored, kept the bundled one: ${parsed.error}`,
		};
	return Date.parse(parsed.catalogue.updatedAt) > Date.parse(base.updatedAt)
		? { catalogue: parsed.catalogue, source: "operator" }
		: { catalogue: base, source: "bundled" };
}

export function catalogueModels(
	catalogue: ModelCatalogue,
	harnessId: string,
): ModelEntry[] {
	return catalogue.harnesses[harnessId]?.models ?? [];
}

/** What the catalogue says about `modelId`; `known: false` is a note, never a refusal. */
export function annotateModel(
	catalogue: ModelCatalogue,
	harnessId: string,
	modelId: string,
): { known: true; entry: ModelEntry } | { known: false } {
	const entry = catalogueModels(catalogue, harnessId).find(
		(m) => m.id === modelId,
	);
	return entry ? { known: true, entry } : { known: false };
}
