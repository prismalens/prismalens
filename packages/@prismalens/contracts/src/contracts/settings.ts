/**
 * Settings route contracts
 * LLM configuration, investigation policies, and danger zone operations
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AllInvestigationPoliciesSchema,
	AllLlmConfigsResponseSchema,
	DangerOperationResultSchema,
	FactoryResetInputSchema,
	InvestigationLimitsSchema,
	InvestigationPolicySchema,
	LlmConfigResponseSchema,
	ProviderParamSchema,
	ResetDataInputSchema,
	SetActiveProviderSchema,
	SettingRecordSchema,
	TestLlmResultSchema,
	UpdateInvestigationLimitsSchema,
	UpdateInvestigationPolicySchema,
	UpdateLlmConfigSchema,
} from "../schemas/settings.js";

export const settingsContract = {
	llm: {
		/**
		 * List all LLM configurations
		 * GET /settings/llm
		 */
		list: oc
			.route({
				method: "GET",
				path: "/settings/llm",
				summary: "List all LLM provider configurations",
				tags: ["settings"],
			})
			.input(z.object({}))
			.output(AllLlmConfigsResponseSchema),

		/**
		 * Get LLM configuration for a provider
		 * GET /settings/llm/:provider
		 */
		get: oc
			.route({
				method: "GET",
				path: "/settings/llm/{provider}",
				summary: "Get LLM configuration for a provider",
				tags: ["settings"],
			})
			.input(ProviderParamSchema)
			.output(LlmConfigResponseSchema),

		/**
		 * Update LLM configuration for a provider
		 * PUT /settings/llm/:provider
		 */
		update: oc
			.route({
				method: "PUT",
				path: "/settings/llm/{provider}",
				summary: "Update LLM configuration for a provider",
				tags: ["settings"],
			})
			.input(ProviderParamSchema.merge(UpdateLlmConfigSchema))
			.output(SettingRecordSchema),

		/**
		 * Delete LLM configuration for a provider
		 * DELETE /settings/llm/:provider
		 */
		delete: oc
			.route({
				method: "DELETE",
				path: "/settings/llm/{provider}",
				summary: "Delete LLM configuration for a provider",
				tags: ["settings"],
			})
			.input(ProviderParamSchema)
			.output(z.void()),

		/**
		 * Test LLM connection
		 * POST /settings/llm/:provider/test
		 */
		test: oc
			.route({
				method: "POST",
				path: "/settings/llm/{provider}/test",
				summary: "Test LLM connection with provided credentials",
				tags: ["settings"],
			})
			.input(ProviderParamSchema.merge(UpdateLlmConfigSchema))
			.output(TestLlmResultSchema),

		/**
		 * Set active LLM provider
		 * PUT /settings/llm/active
		 */
		setActive: oc
			.route({
				method: "PUT",
				path: "/settings/llm/active",
				summary: "Set the active LLM provider",
				tags: ["settings"],
			})
			.input(SetActiveProviderSchema)
			.output(SettingRecordSchema),
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
