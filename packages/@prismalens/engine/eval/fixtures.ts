// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Golden-incident fixture loader (Phase B.3 pulled-forward eval slice — the plan's
 * "B.3 can't be validated without evals" gap). Lives OUTSIDE `src/` so it never
 * ships in `dist` (tsconfig's `include` is `src/**\/*`, so this directory is
 * excluded from the build/publish surface for free — no extra exclude needed).
 *
 * Each fixture is a realistic synthetic branch stream (agent_steps + tool_results
 * whose previews carry the diagnostic evidence, grounded in plausible
 * prom/loki/kubectl output) for ONE golden incident, schema-validated against the
 * same contracts the real engine uses — so a fixture that drifts from the
 * `CanonicalEvent`/`InvestigationContext` shape fails LOUD at load time, not
 * silently at synthesis time.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type CanonicalEvent,
	CanonicalEventSchema,
	type InvestigationContext,
	InvestigationContextSchema,
} from "@prismalens/contracts";
import { z } from "zod";

const FixtureExpectedSchema = z.object({
	/** The top-1 hypothesis must contain AT LEAST ONE of these (case-insensitive). */
	rootCauseKeywords: z.array(z.string().min(1)).min(1),
	/** The top-1 hypothesis must contain NONE of these — guards against a red-herring. */
	mustNotContain: z.array(z.string().min(1)).optional(),
});

const FixtureFileSchema = z.object({
	name: z.string().min(1),
	context: InvestigationContextSchema,
	transcriptEvents: z.array(CanonicalEventSchema).min(1),
	expected: FixtureExpectedSchema,
});

export type FixtureExpected = z.infer<typeof FixtureExpectedSchema>;

export interface GoldenIncidentFixture {
	name: string;
	context: InvestigationContext;
	transcriptEvents: CanonicalEvent[];
	expected: FixtureExpected;
}

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/**
 * Load + schema-validate every `*.json` fixture in `eval/fixtures/`, sorted by
 * filename (the `NN-name.json` prefix controls scorecard print order). Throws
 * (with the offending file name) on a fixture that doesn't parse — a fixture
 * must be schema-valid, same as any other engine input (AGENTS.md boundary gate).
 */
export function loadFixtures(
	dir: string = FIXTURES_DIR,
): GoldenIncidentFixture[] {
	const files = readdirSync(dir)
		.filter((f) => f.endsWith(".json"))
		.sort();
	if (files.length === 0) {
		throw new Error(`eval: no fixture files found in ${dir}`);
	}
	return files.map((file) => {
		const raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
		const parsed = FixtureFileSchema.safeParse(raw);
		if (!parsed.success) {
			throw new Error(
				`eval: fixture ${file} failed schema validation: ${parsed.error.message}`,
			);
		}
		return parsed.data;
	});
}
