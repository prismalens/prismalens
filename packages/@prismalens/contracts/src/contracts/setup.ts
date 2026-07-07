// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Setup route contracts
 * Initial setup: owner account creation only
 */
import { oc } from "@orpc/contract";
import { z } from "zod";

// =============================================================================
// SCHEMAS
// =============================================================================

const SetupStepEnum = z.enum(["account", "complete"]);

const SetupStatusSchema = z.object({
	setupComplete: z.boolean(),
	steps: z.object({
		owner: z.boolean(),
	}),
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
