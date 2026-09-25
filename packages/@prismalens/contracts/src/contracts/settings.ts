// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Settings route contracts
 * LLM configuration, investigation policies, and danger zone operations
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AboutSchema,
	CheckHarnessInputSchema,
	DangerOperationResultSchema,
	FactoryResetInputSchema,
	HarnessesResponseSchema,
	HarnessProbeResultSchema,
	HarnessSettingsSchema,
	ReportDeliverySettingsSchema,
	ResetDataInputSchema,
	TelemetrySettingsSchema,
	UpdateHarnessSettingsSchema,
	UpdateReportDeliverySchema,
	UpdateTelemetrySettingsSchema,
} from "../schemas/settings.js";

export const settingsContract = {
	/**
	 * Version, install channel, update status and the upgrade/uninstall commands (#717)
	 * GET /settings/about
	 */
	about: {
		get: oc
			.route({
				method: "GET",
				path: "/settings/about",
				summary: "What this install is and whether a newer release is out",
				tags: ["settings"],
			})
			.output(AboutSchema),
	},

	telemetry: {
		/**
		 * Opt-in telemetry state (#602)
		 * GET /settings/telemetry
		 */
		get: oc
			.route({
				method: "GET",
				path: "/settings/telemetry",
				summary: "Get the opt-in telemetry setting",
				tags: ["settings"],
			})
			.output(TelemetrySettingsSchema),

		/**
		 * Answer the telemetry question or flip the toggle
		 * PUT /settings/telemetry
		 */
		update: oc
			.route({
				method: "PUT",
				path: "/settings/telemetry",
				summary: "Turn opt-in telemetry on or off",
				tags: ["settings"],
			})
			.input(UpdateTelemetrySettingsSchema)
			.output(TelemetrySettingsSchema),
	},

	delivery: {
		/**
		 * Whether a Slack webhook is set for finished reports (#606)
		 * GET /settings/delivery
		 */
		get: oc
			.route({
				method: "GET",
				path: "/settings/delivery",
				summary: "Get report delivery settings",
				tags: ["settings"],
			})
			.output(ReportDeliverySettingsSchema),

		/**
		 * Set or remove the Slack incoming webhook
		 * PUT /settings/delivery
		 */
		update: oc
			.route({
				method: "PUT",
				path: "/settings/delivery",
				summary: "Set or remove the Slack incoming webhook",
				tags: ["settings"],
			})
			.input(UpdateReportDeliverySchema)
			.output(ReportDeliverySettingsSchema),
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
		/**
		 * On-demand ACP handshake against one harness — the same probe `pl
		 * doctor` runs, behind a button rather than page load (#630).
		 * POST /settings/harness/check
		 */
		checkHarness: oc
			.route({
				method: "POST",
				path: "/settings/harness/check",
				summary:
					"Probe one harness with an ACP handshake (initialize + session/new, no prompt turn)",
				tags: ["settings"],
			})
			.input(CheckHarnessInputSchema)
			.output(HarnessProbeResultSchema),
	},
};
