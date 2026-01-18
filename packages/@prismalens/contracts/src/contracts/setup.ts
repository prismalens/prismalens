/**
 * Setup route contracts
 * Initial setup and owner creation
 */
import { oc } from "@orpc/contract";
import { z } from "zod";

// =============================================================================
// SCHEMAS
// =============================================================================

export const SetupStepEnum = z.enum(["account", "ai", "integration", "complete"]);

export const SetupStatusSchema = z.object({
	setupComplete: z.boolean(),
	steps: z.object({
		owner: z.boolean(),
		llm: z.boolean(),
		integrations: z.boolean(),
	}),
	currentStep: SetupStepEnum,
});

export const MarkStepSkippedInputSchema = z.object({
	step: z.enum(["ai", "integration"]),
});

export const MarkStepSkippedResponseSchema = z.object({
	success: z.boolean(),
});

export const CreateOwnerInputSchema = z.object({
	email: z.string().email(),
	password: z.string().min(8),
	name: z.string().optional(),
});

export const CreateOwnerResponseSchema = z.object({
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

	/**
	 * Mark an optional setup step as skipped
	 * POST /setup/skip
	 */
	markStepSkipped: oc
		.route({
			method: "POST",
			path: "/setup/skip",
			summary: "Mark an optional setup step as skipped",
			tags: ["setup"],
		})
		.input(MarkStepSkippedInputSchema)
		.output(MarkStepSkippedResponseSchema),
};

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type SetupStep = z.infer<typeof SetupStepEnum>;
export type SetupStatus = z.infer<typeof SetupStatusSchema>;
export type CreateOwnerInput = z.infer<typeof CreateOwnerInputSchema>;
export type CreateOwnerResponse = z.infer<typeof CreateOwnerResponseSchema>;
export type MarkStepSkippedInput = z.infer<typeof MarkStepSkippedInputSchema>;
export type MarkStepSkippedResponse = z.infer<typeof MarkStepSkippedResponseSchema>;
