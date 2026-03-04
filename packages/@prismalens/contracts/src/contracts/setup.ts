/**
 * Setup route contracts
 * Initial setup and owner creation
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	LlmEnvStatusResponseSchema,
	LlmSettingsSchema,
	ModelsListResponseSchema,
	SaveLlmCredentialSchema,
	TestLlmConnectionInputSchema,
	TestLlmResultSchema,
	UpdateLlmSettingsSchema,
} from "../schemas/settings.js";

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

	/**
	 * Get LLM env status (public — needed during setup before auth)
	 * GET /setup/llm/env-status
	 */
	getLlmEnvStatus: oc
		.route({
			method: "GET",
			path: "/setup/llm/env-status",
			summary: "Get LLM provider env status during setup",
			tags: ["setup"],
		})
		.input(z.object({}))
		.output(LlmEnvStatusResponseSchema),

	/**
	 * Get available LLM models (public — needed during setup before auth)
	 * GET /setup/llm/models
	 */
	getLlmModels: oc
		.route({
			method: "GET",
			path: "/setup/llm/models",
			summary: "Get available LLM models during setup",
			tags: ["setup"],
		})
		.input(z.object({ provider: z.string().optional() }))
		.output(ModelsListResponseSchema),

	/**
	 * Save LLM credential (public — needed during setup before auth)
	 * POST /setup/llm/credentials
	 */
	saveLlmCredential: oc
		.route({
			method: "POST",
			path: "/setup/llm/credentials",
			summary: "Save encrypted LLM API key during setup",
			tags: ["setup"],
		})
		.input(SaveLlmCredentialSchema)
		.output(z.object({ success: z.boolean() })),

	/**
	 * Update LLM settings (public — needed during setup before auth)
	 * PUT /setup/llm/settings
	 */
	updateLlmSettings: oc
		.route({
			method: "PUT",
			path: "/setup/llm/settings",
			summary: "Update LLM settings during setup",
			tags: ["setup"],
		})
		.input(UpdateLlmSettingsSchema)
		.output(LlmSettingsSchema),

	/**
	 * Test LLM connection (public — needed during setup before auth)
	 * POST /setup/llm/test-connection
	 */
	testLlmConnection: oc
		.route({
			method: "POST",
			path: "/setup/llm/test-connection",
			summary: "Test LLM connection during setup",
			tags: ["setup"],
		})
		.input(TestLlmConnectionInputSchema)
		.output(TestLlmResultSchema),
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
