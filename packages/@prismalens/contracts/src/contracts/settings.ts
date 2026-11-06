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
	DiagnosticsSchema,
	FactoryResetInputSchema,
	HarnessesResponseSchema,
	HarnessProbeResultSchema,
	HarnessSettingsSchema,
	InstallUpdateInputSchema,
	ReportDeliverySettingsSchema,
	ResetDataInputSchema,
	TelemetrySettingsSchema,
	UpdateHarnessSettingsSchema,
	UpdateInstallStatusSchema,
	UpdatePrefsSchema,
	UpdateReportDeliverySchema,
	UpdateTelemetrySettingsSchema,
} from "../schemas/settings.js";
import {
	EditorsSchema,
	ThreadContextSettingsSchema,
} from "../schemas/thread-context.js";

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
		/**
		 * What `pl doctor` checks, run in the API. Host only (#932).
		 * GET /settings/about/diagnostics
		 */
		diagnostics: oc
			.route({
				method: "GET",
				path: "/settings/about/diagnostics",
				summary: "Run the doctor checks on this machine",
				tags: ["settings"],
			})
			.output(DiagnosticsSchema),
	},

	/** Check, install and the update preferences (#724, #1024 E). */
	update: {
		/**
		 * Check for a newer release now, ignoring the day-long cache
		 * POST /settings/update/check
		 */
		check: oc
			.route({
				method: "POST",
				path: "/settings/update/check",
				summary: "Check for a newer release now",
				tags: ["settings"],
			})
			.output(AboutSchema),
		/**
		 * Install the offered release into the installer's runtime folder and restart. Host only, idle only.
		 * POST /settings/update/install
		 */
		install: oc
			.route({
				method: "POST",
				path: "/settings/update/install",
				successStatus: 202,
				summary: "Install the newer release and restart",
				tags: ["settings"],
			})
			.input(InstallUpdateInputSchema)
			.output(UpdateInstallStatusSchema),
		/**
		 * Where an install stands
		 * GET /settings/update/status
		 */
		status: oc
			.route({
				method: "GET",
				path: "/settings/update/status",
				summary: "Where an update install stands",
				tags: ["settings"],
			})
			.output(UpdateInstallStatusSchema),
		/**
		 * Check for updates, and what to do when one is ready. Host only.
		 * PUT /settings/update
		 */
		prefs: oc
			.route({
				method: "PUT",
				path: "/settings/update",
				summary: "Set the update preferences",
				tags: ["settings"],
			})
			.input(UpdatePrefsSchema)
			.output(AboutSchema),
	},

	telemetry: {
		/**
		 * Usage telemetry state (#673 w45)
		 * GET /settings/telemetry
		 */
		get: oc
			.route({
				method: "GET",
				path: "/settings/telemetry",
				summary: "Get the usage telemetry setting",
				tags: ["settings"],
			})
			.output(TelemetrySettingsSchema),

		/**
		 * Record the notice shown or dismissed, or flip the toggle
		 * PUT /settings/telemetry
		 */
		update: oc
			.route({
				method: "PUT",
				path: "/settings/telemetry",
				summary: "Turn usage telemetry on or off",
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

	/** The editors on this computer's PATH (#1024). */
	editors: {
		list: oc
			.route({
				method: "GET",
				path: "/settings/editors",
				summary: "List the editors PrismaLens can open files in",
				tags: ["settings"],
			})
			.output(EditorsSchema),
	},

	/** "Show pull request status" and "Open files in" (#1024). */
	threadContext: {
		get: oc
			.route({
				method: "GET",
				path: "/settings/thread-context",
				summary: "Read the pull request status and editor settings",
				tags: ["settings"],
			})
			.output(ThreadContextSettingsSchema),
		update: oc
			.route({
				method: "PUT",
				path: "/settings/thread-context",
				summary: "Change the pull request status and editor settings",
				tags: ["settings"],
			})
			.input(ThreadContextSettingsSchema)
			.output(ThreadContextSettingsSchema),
	},
};
