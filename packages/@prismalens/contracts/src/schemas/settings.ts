// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Settings schemas: harness detection, investigation policy, danger zone, MCP.
 */

import { HARNESS_IDS } from "@prismalens/config/harness";
import { z } from "zod";

// =============================================================================
// HARNESS (detect and report, ADR 0003 §9)
// =============================================================================

/** Harness setting: "auto" or an explicit harness ID. PRISMALENS_HARNESS overrides. */
export const HarnessSettingSchema = z.enum(["auto", ...HARNESS_IDS]);
export type HarnessSetting = z.infer<typeof HarnessSettingSchema>;

/** One registry row as the doctor and the settings card show it. */
export const HarnessStatusSchema = z.object({
	id: z.string(),
	label: z.string(),
	binary: z.string(),
	installed: z.boolean(),
	/** Passed the registry admission run in CI; auto-selection considers only these. */
	verified: z.boolean(),
	/** One-line install hint, shown when not installed. */
	install: z.string(),
	/** The model prismalens asks for when the operator set none; null means the harness's own default. */
	defaultModel: z.string().nullable(),
});
export type HarnessStatus = z.infer<typeof HarnessStatusSchema>;

/** Would an investigation start right now? The gate's own words, never rewritten. */
export const HarnessSelectionStatusSchema = z.object({
	runnable: z.boolean(),
	harness: z.string().nullable(),
	/** Pinned rather than auto-selected, by PRISMALENS_HARNESS or by Settings → Harness. */
	pinned: z.boolean(),
	pinnedBy: z.enum(["env", "settings"]).nullable(),
	blockedReason: z.string().nullable(),
});
export type HarnessSelectionStatus = z.infer<
	typeof HarnessSelectionStatusSchema
>;

/** Persisted harness choice; PRISMALENS_HARNESS wins over it. */
export const HarnessSettingsSchema = z.object({
	harness: HarnessSettingSchema,
	/** Model id in the harness's own format; absent means the harness default. */
	model: z.string().min(1).max(200).optional(),
});
export type HarnessSettings = z.infer<typeof HarnessSettingsSchema>;

export const UpdateHarnessSettingsSchema = HarnessSettingsSchema.partial();
export type UpdateHarnessSettings = z.infer<typeof UpdateHarnessSettingsSchema>;

export const HarnessesResponseSchema = z.object({
	harnesses: z.array(HarnessStatusSchema),
	selection: HarnessSelectionStatusSchema,
});
export type HarnessesResponse = z.infer<typeof HarnessesResponseSchema>;

/** `pl doctor`'s ACP handshake, on demand from the Settings Harness tab (#630, Unit D on #337). */
export const CheckHarnessInputSchema = z.object({
	id: z.enum(HARNESS_IDS),
});
export type CheckHarnessInput = z.infer<typeof CheckHarnessInputSchema>;

/** `initialize` + `session/new`, no prompt turn. Four outcomes; `detail` is the words `pl doctor` prints too, one line. */
export const HarnessProbeResultSchema = z.object({
	id: z.enum(HARNESS_IDS),
	outcome: z.enum([
		"answers-acp",
		"sign-in-needed",
		"no-answer",
		"failed-to-start",
	]),
	detail: z.string(),
	hard: z.literal(false),
});
export type HarnessProbeResult = z.infer<typeof HarnessProbeResultSchema>;

// =============================================================================
// INVESTIGATION POLICIES
// =============================================================================

/**
 * Per-service auto-investigation policy, stored under the service's
 * `metadata.investigation.trigger` and read by the API's trigger service when an
 * alert lands on an incident. A service without one uses the default.
 */
export const TriggerPolicySchema = z.enum([
	"always",
	"critical_and_high",
	"critical_only",
	"never",
]);
export type TriggerPolicy = z.infer<typeof TriggerPolicySchema>;
export const DEFAULT_TRIGGER_POLICY: TriggerPolicy = "critical_and_high";

// =============================================================================
// INVESTIGATION TRIGGERS
// =============================================================================

/**
 * Investigation trigger types - how investigations can be started
 */
export const InvestigationTriggerTypeSchema = z.enum([
	"manual", // User clicks "Investigate" button
	"auto_critical", // Auto-triggered for critical severity
	"auto_tier", // Auto-triggered based on service tier
	"alert_threshold", // Auto-triggered when alert count exceeds threshold
	"scheduled", // Auto-triggered for stale incidents
	"re_trigger", // Re-triggered when new alerts are added
]);
export type InvestigationTriggerType = z.infer<
	typeof InvestigationTriggerTypeSchema
>;

/**
 * Update strategy for alerts arriving during investigation
 */
export const InvestigationUpdateStrategySchema = z.enum([
	"ignore", // Don't notify - investigation proceeds
	"notify", // Add to pendingAlerts for Commander awareness
	"queue_partial", // Queue partial re-analysis after completion
	"restart", // Cancel and restart investigation
]);
export type InvestigationUpdateStrategy = z.infer<
	typeof InvestigationUpdateStrategySchema
>;

// =============================================================================
// DANGER ZONE
// =============================================================================

export const ResetDataInputSchema = z.object({
	confirmation: z.literal("RESET"),
});
export type ResetDataInput = z.infer<typeof ResetDataInputSchema>;

export const FactoryResetInputSchema = z.object({
	confirmation: z.literal("FACTORY RESET"),
});
export type FactoryResetInput = z.infer<typeof FactoryResetInputSchema>;

export const DangerOperationResultSchema = z.object({
	success: z.boolean(),
	message: z.string().optional(),
});
export type DangerOperationResult = z.infer<typeof DangerOperationResultSchema>;

import { type MCPServerId, mcpServerIdSchema } from "@prismalens/config/mcp";

/**
 * MCP server ID schema - re-exported from @prismalens/config
 */
export const McpServerIdSchema = mcpServerIdSchema;
export type McpServerId = MCPServerId;

/**
 * Per-server MCP configuration stored in DB
 * Note: Credentials come from IntegrationContext, not stored here
 */
export const McpServerSettingsSchema = z.object({
	enabled: z.boolean().default(true),
	readOnlyMode: z.boolean().default(true),
	toolFilter: z.array(z.string()).optional(),
	// Custom transport overrides (optional - uses defaults if not set)
	customHttpUrl: z.string().url().optional(),
	customDockerImage: z.string().optional(),
});
export type McpServerSettings = z.infer<typeof McpServerSettingsSchema>;

/**
 * Full MCP settings structure stored in DB
 */
export const McpSettingsSchema = z.object({
	servers: z.partialRecord(McpServerIdSchema, McpServerSettingsSchema),
});
export type McpSettings = z.infer<typeof McpSettingsSchema>;

/**
 * Update MCP settings input (partial update)
 */
export const UpdateMcpSettingsSchema = z.object({
	servers: z
		.partialRecord(McpServerIdSchema, McpServerSettingsSchema.partial())
		.optional(),
});
export type UpdateMcpSettings = z.infer<typeof UpdateMcpSettingsSchema>;

/**
 * MCP server status (runtime state)
 */
export const McpServerStatusSchema = z.object({
	serverId: McpServerIdSchema,
	enabled: z.boolean(),
	readOnlyMode: z.boolean(),
	hasCredentials: z.boolean(),
	isReady: z.boolean(), // enabled && hasCredentials
	integrationType: z.string(),
	toolFilter: z.array(z.string()).optional(),
});
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;

/**
 * Full MCP status response
 */
export const McpStatusResponseSchema = z.object({
	servers: z.array(McpServerStatusSchema),
});
export type McpStatusResponse = z.infer<typeof McpStatusResponseSchema>;

/**
 * Test MCP connection input
 */
export const TestMcpConnectionInputSchema = z.object({
	serverId: McpServerIdSchema,
});
export type TestMcpConnectionInput = z.infer<
	typeof TestMcpConnectionInputSchema
>;

/**
 * Test MCP connection result
 */
export const TestMcpResultSchema = z.object({
	success: z.boolean(),
	error: z.string().optional(),
	toolCount: z.number().optional(),
});
export type TestMcpResult = z.infer<typeof TestMcpResultSchema>;

/**
 * Where a finished report is posted (#606, ADR 0008 §1: a Slack incoming webhook
 * first). The URL is a secret; it is stored encrypted and never read back.
 */
export const ReportDeliverySettingsSchema = z.object({
	slackConfigured: z.boolean(),
});
export type ReportDeliverySettings = z.infer<
	typeof ReportDeliverySettingsSchema
>;

/** Only Slack's own webhook hosts, so the setting cannot point the server anywhere else. */
export const SLACK_WEBHOOK_URL =
	/^https:\/\/hooks\.slack(-gov)?\.com\/services\/[A-Za-z0-9/_-]+$/;

export const UpdateReportDeliverySchema = z.object({
	/** null removes the webhook. */
	slackWebhookUrl: z
		.string()
		.trim()
		.regex(
			SLACK_WEBHOOK_URL,
			"Must be a https://hooks.slack.com/services/… URL",
		)
		.nullable(),
});
export type UpdateReportDelivery = z.infer<typeof UpdateReportDeliverySchema>;
