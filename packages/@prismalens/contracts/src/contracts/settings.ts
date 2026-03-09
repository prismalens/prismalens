/**
 * Settings route contracts
 * LLM configuration, investigation policies, and danger zone operations
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AllInvestigationPoliciesSchema,
	DangerOperationResultSchema,
	DeleteLlmCredentialSchema,
	FactoryResetInputSchema,
	InvestigationLimitsSchema,
	InvestigationPolicySchema,
	LlmCredentialStatusResponseSchema,
	LlmEnvStatusResponseSchema,
	LlmSettingsSchema,
	ModelsListResponseSchema,
	ResetDataInputSchema,
	SaveLlmCredentialSchema,
	TestLlmConnectionInputSchema,
	TestLlmResultSchema,
	UpdateInvestigationLimitsSchema,
	UpdateInvestigationPolicySchema,
	UpdateLlmSettingsSchema,
} from "../schemas/settings.js";

export const settingsContract = {
	llm: {
		/**
		 * Get environment variable status for all providers
		 * GET /settings/llm/env-status
		 */
		getEnvStatus: oc
			.route({
				method: "GET",
				path: "/settings/llm/env-status",
				summary: "Get environment variable status for all LLM providers",
				tags: ["settings"],
			})
			.input(z.object({}))
			.output(LlmEnvStatusResponseSchema),

		/**
		 * Get full LLM settings (model, temperature, per-agent overrides)
		 * GET /settings/llm/config
		 */
		getSettings: oc
			.route({
				method: "GET",
				path: "/settings/llm/config",
				summary: "Get comprehensive LLM configuration settings",
				tags: ["settings"],
			})
			.input(z.object({}))
			.output(LlmSettingsSchema),

		/**
		 * Update LLM settings
		 * PATCH /settings/llm/config
		 */
		updateSettings: oc
			.route({
				method: "PATCH",
				path: "/settings/llm/config",
				summary: "Update LLM configuration settings",
				tags: ["settings"],
			})
			.input(UpdateLlmSettingsSchema)
			.output(LlmSettingsSchema),

		/**
		 * Get available models from registry
		 * GET /settings/llm/models
		 */
		getModels: oc
			.route({
				method: "GET",
				path: "/settings/llm/models",
				summary: "Get available models from models registry",
				tags: ["settings"],
			})
			.input(z.object({ provider: z.string().optional() }))
			.output(ModelsListResponseSchema),

		/**
		 * Test LLM connection using env vars
		 * POST /settings/llm/test-connection
		 */
		testConnection: oc
			.route({
				method: "POST",
				path: "/settings/llm/test-connection",
				summary: "Test LLM connection using environment variables",
				tags: ["settings"],
			})
			.input(TestLlmConnectionInputSchema)
			.output(TestLlmResultSchema),

		/**
		 * Save an encrypted LLM API key for a provider
		 * POST /settings/llm/credentials
		 */
		saveCredential: oc
			.route({
				method: "POST",
				path: "/settings/llm/credentials",
				summary: "Save an encrypted LLM API key for a provider",
				tags: ["settings"],
			})
			.input(SaveLlmCredentialSchema)
			.output(z.object({ success: z.boolean() })),

		/**
		 * Delete an LLM API key for a provider
		 * DELETE /settings/llm/credentials
		 */
		deleteCredential: oc
			.route({
				method: "DELETE",
				path: "/settings/llm/credentials",
				summary: "Delete an LLM API key for a provider",
				tags: ["settings"],
			})
			.input(DeleteLlmCredentialSchema)
			.output(z.object({ success: z.boolean() })),

		/**
		 * Get credential status for all providers
		 * GET /settings/llm/credential-status
		 */
		getCredentialStatus: oc
			.route({
				method: "GET",
				path: "/settings/llm/credential-status",
				summary: "Get credential status for all LLM providers",
				tags: ["settings"],
			})
			.input(z.object({}))
			.output(LlmCredentialStatusResponseSchema),
	},

	investigation: {
		/**
		 * Get all investigation policies
		 * GET /settings/investigation/policies
		 */
		getPolicies: oc
			.route({
				method: "GET",
				path: "/settings/investigation/policies",
				summary: "Get investigation policies for all tiers",
				tags: ["settings"],
			})
			.input(z.object({}))
			.output(AllInvestigationPoliciesSchema),

		/**
		 * Update investigation policy for a tier
		 * PUT /settings/investigation/policies/:tier
		 */
		updatePolicy: oc
			.route({
				method: "PUT",
				path: "/settings/investigation/policies/{tier}",
				summary: "Update investigation policy for a tier",
				tags: ["settings"],
			})
			.input(UpdateInvestigationPolicySchema)
			.output(InvestigationPolicySchema),

		/**
		 * Get investigation limits
		 * GET /settings/investigation/limits
		 */
		getLimits: oc
			.route({
				method: "GET",
				path: "/settings/investigation/limits",
				summary: "Get investigation limits",
				tags: ["settings"],
			})
			.input(z.object({}))
			.output(InvestigationLimitsSchema),

		/**
		 * Update investigation limits
		 * PUT /settings/investigation/limits
		 */
		updateLimits: oc
			.route({
				method: "PUT",
				path: "/settings/investigation/limits",
				summary: "Update investigation limits",
				tags: ["settings"],
			})
			.input(UpdateInvestigationLimitsSchema)
			.output(InvestigationLimitsSchema),
	},

	danger: {
		/**
		 * Reset all data (alerts, incidents, investigations)
		 * POST /settings/danger/reset-data
		 */
		resetData: oc
			.route({
				method: "POST",
				path: "/settings/danger/reset-data",
				summary: "Reset all data (keeps services and settings)",
				tags: ["settings"],
			})
			.input(ResetDataInputSchema)
			.output(DangerOperationResultSchema),

		/**
		 * Factory reset (delete everything)
		 * POST /settings/danger/factory-reset
		 */
		factoryReset: oc
			.route({
				method: "POST",
				path: "/settings/danger/factory-reset",
				summary: "Factory reset - delete all data and return to setup",
				tags: ["settings"],
			})
			.input(FactoryResetInputSchema)
			.output(DangerOperationResultSchema),
	},
};
