// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Setup route contracts
 *
 * The on-ramp (#332). Three steps, in order:
 *
 *   ai_provider → code_location → first_incident → complete
 *
 * The step a reload resumes on is DERIVED on the server from durable state
 * (a user row, a stored credential, a mapped checkout, an incident row) — the
 * wizard stores no progress of its own. That is what makes the flow resumable
 * across a reload, a sign-in bounce, or a different browser without a
 * `SETUP_PROGRESS` row that can disagree with reality.
 *
 * There is no account and nothing here gates the app (ADR 0001 §2). The steps
 * drive `currentStep` and the on-ramp hints in empty states.
 */
import { oc } from "@orpc/contract";
import { z } from "zod";

// =============================================================================
// SCHEMAS
// =============================================================================

export const SetupStepEnum = z.enum([
	"ai_provider",
	"code_location",
	"first_incident",
	"complete",
]);

const SetupStatusSchema = z.object({
	steps: z.object({
		/** A harness is on PATH and would run right now. */
		aiProvider: z.boolean(),
		/** At least one service has a repository linked. */
		codeLocation: z.boolean(),
		/** At least one incident exists — the thing there is to investigate. */
		firstIncident: z.boolean(),
	}),
	/** The first incomplete step, or `complete` when none remain. */
	currentStep: SetupStepEnum,
});

// =============================================================================
// CONTRACT
// =============================================================================

export const setupContract = {
	/**
	 * Check if initial setup is complete
	 * GET /setup/status
	 */
	getStatus: oc
		.route({
			method: "GET",
			path: "/setup/status",
			summary: "Check if initial setup is complete",
			tags: ["setup"],
		})
		.input(z.object({}))
		.output(SetupStatusSchema),
};

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type SetupStep = z.infer<typeof SetupStepEnum>;
export type SetupStatus = z.infer<typeof SetupStatusSchema>;

/**
 * The wizard's step order, single-sourced from the contract enum so the
 * frontend progress bar and the server's `currentStep` can never disagree.
 * `complete` is the terminal state, not a step, so it is excluded.
 */
export const SETUP_STEP_ORDER = SetupStepEnum.options.filter(
	(step): step is Exclude<SetupStep, "complete"> => step !== "complete",
);
