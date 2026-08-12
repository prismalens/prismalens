// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Setup route contracts
 *
 * The first-run wizard (#332). Four steps, in order:
 *
 *   account → ai_provider → code_location → first_incident → complete
 *
 * The step a reload resumes on is DERIVED on the server from durable state
 * (a user row, a stored credential, a mapped checkout, an incident row) — the
 * wizard stores no progress of its own. That is what makes the flow resumable
 * across a reload, a sign-in bounce, or a different browser without a
 * `SETUP_PROGRESS` row that can disagree with reality.
 *
 * `setupComplete` deliberately means ONLY "an owner account exists". It is the
 * auth gate (`/_authenticated` bounces to `/setup` when it is false), so
 * widening it to the later steps would lock an operator who never configures a
 * provider out of the whole app. The later steps drive `currentStep` and the
 * on-ramp hints in empty states; they never gate access.
 */
import { oc } from "@orpc/contract";
import { z } from "zod";

// =============================================================================
// SCHEMAS
// =============================================================================

export const SetupStepEnum = z.enum([
	"account",
	"ai_provider",
	"code_location",
	"first_incident",
	"complete",
]);

const SetupStatusSchema = z.object({
	/** An owner account exists. This — and only this — gates the app. */
	setupComplete: z.boolean(),
	steps: z.object({
		/** An account with an admin role exists. */
		owner: z.boolean(),
		/** Some LLM provider has a usable key, or a keyless provider is active. */
		aiProvider: z.boolean(),
		/** At least one service has a `localCheckoutPath`. */
		codeLocation: z.boolean(),
		/** At least one incident exists — the thing there is to investigate. */
		firstIncident: z.boolean(),
	}),
	/** The first incomplete step, or `complete` when none remain. */
	currentStep: SetupStepEnum,
});

const CreateOwnerInputSchema = z.object({
	email: z.string().email(),
	password: z.string().min(8),
	name: z.string().optional(),
});

const CreateOwnerResponseSchema = z.object({
	user: z.object({
		id: z.string(),
		email: z.string(),
		name: z.string().nullable(),
		role: z.string(),
	}),
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

	/**
	 * Create the first admin account
	 * POST /setup
	 */
	createOwner: oc
		.route({
			method: "POST",
			path: "/setup",
			summary: "Create the first admin account during initial setup",
			tags: ["setup"],
		})
		.input(CreateOwnerInputSchema)
		.output(CreateOwnerResponseSchema),
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
