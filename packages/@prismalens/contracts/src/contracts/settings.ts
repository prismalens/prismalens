// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Settings route contracts
 * LLM configuration, investigation policies, and danger zone operations
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AllInvestigationPoliciesSchema,
	DangerOperationResultSchema,
	FactoryResetInputSchema,
	HarnessesResponseSchema,
	HarnessSettingsSchema,
	InvestigationLimitsSchema,
	InvestigationPolicySchema,
	ResetDataInputSchema,
	UpdateHarnessSettingsSchema,
	UpdateInvestigationLimitsSchema,
	UpdateInvestigationPolicySchema,
} from "../schemas/settings.js";

export const settingsContract = {
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

	harnesses: {
		/**
		 * Get detected harnesses and the selection verdict
		 * GET /settings/harnesses
		 */
		getHarnesses: oc
			.route({
				method: "GET",
				path: "/settings/harnesses",
				summary: "Get detected harnesses and the selection verdict",
				tags: ["settings"],
			})
			.input(z.object({}))
			.output(HarnessesResponseSchema),
		/**
		 * The persisted harness choice and model
		 * GET /settings/harness
		 */
		getSettings: oc
			.route({
				method: "GET",
				path: "/settings/harness",
				summary: "Get the persisted harness choice",
				tags: ["settings"],
			})
			.input(z.object({}))
			.output(HarnessSettingsSchema),
		/**
		 * Persist the harness choice and model
		 * PATCH /settings/harness
		 */
		updateSettings: oc
			.route({
				method: "PATCH",
				path: "/settings/harness",
				summary: "Persist the harness choice and model",
				tags: ["settings"],
			})
			.input(UpdateHarnessSettingsSchema)
			.output(HarnessSettingsSchema),
	},
};
