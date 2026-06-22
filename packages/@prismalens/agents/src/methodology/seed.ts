/**
 * Seed-call semantics — contract only; work-unit 002 executes it pre-loop
 * (work-unit 004, FR-13).
 *
 * Generalizes the product's scout `preGather` (`agents/scout/index.ts`, story
 * 06.1) off its hardcoded `incident/alerts/changeEvents/similarIncidents`
 * fetch: seed calls are DERIVED from the connected integrations and their
 * profile `seedCallHint`s, not wired to a fixed signal set. Seeds are always
 * `readonly` (Principle IV) and produce baseline `Finding`s + a `Coverage`
 * baseline before the investigation loop begins.
 */

import type { Finding } from "./findings.js";
import type { Coverage } from "./report.js";

/** A single pre-loop readonly probe against one integration. */
export interface SeedCall {
	/** Integration/source key (e.g. `'prometheus'`). */
	integration: string;
	/** The profile/tool to invoke (e.g. `'metrics'`). */
	tool: string;
	/** Seeds are always readonly — they never mutate (Principle IV). */
	capability: "readonly";
	/** Optional call arguments resolved by 002 from the trigger context. */
	args?: Record<string, unknown>;
	/** Why this seed call is worth running first. */
	rationale: string;
}

/** The derived pre-loop plan for an investigation. */
export interface SeedPlan {
	/** The integration seeded first (the primary connected source). */
	primaryIntegration: string;
	calls: SeedCall[];
}

/** What executing a `SeedPlan` yields (002 produces this, pre-loop). */
export interface SeedResult {
	findings: Finding[];
	coverage: Coverage;
}

/**
 * The slice of a profile-seed entry `planSeed` needs (kept structural to avoid
 * a hard dependency on `profiles.ts`'s concrete catalog).
 */
export interface ProfileSeedHint {
	profileName: string;
	integrationSource: string;
	seedCallHint: string;
	capabilityTag: string;
}

/**
 * Derive a `SeedPlan` for the PRIMARY connected integration (FR-13). The
 * primary is the first connected integration; its readonly profile seeds
 * become the pre-loop calls. 002 executes the plan and emits a `SeedResult`.
 */
export function planSeed(
	connectedIntegrations: string[],
	profileSeeds: ReadonlyArray<ProfileSeedHint>,
): SeedPlan {
	const primaryIntegration = connectedIntegrations[0] ?? "";
	const calls: SeedCall[] = profileSeeds
		.filter(
			(p) =>
				p.integrationSource === primaryIntegration &&
				p.capabilityTag === "readonly",
		)
		.map((p) => ({
			integration: p.integrationSource,
			tool: p.profileName,
			capability: "readonly" as const,
			rationale: p.seedCallHint,
		}));
	return { primaryIntegration, calls };
}
