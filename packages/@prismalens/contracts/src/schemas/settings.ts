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
});
export type HarnessStatus = z.infer<typeof HarnessStatusSchema>;

/** Would an investigation start right now? The gate's own words, never rewritten. */
export const HarnessSelectionStatusSchema = z.object({
	runnable: z.boolean(),
	harness: z.string().nullable(),
	/** Set by PRISMALENS_HARNESS rather than auto-selected. */
	pinned: z.boolean(),
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

// =============================================================================
// INVESTIGATION POLICIES
// =============================================================================

// Auto-investigate modes
export const AutoInvestigateModeSchema = z.enum([
	"always",
	"critical_high",
	"manual",
	"never",
]);
export type AutoInvestigateMode = z.infer<typeof AutoInvestigateModeSchema>;

// Tier values
export const TierSchema = z.enum(["tier_1", "tier_2", "tier_3", "tier_4"]);
export type Tier = z.infer<typeof TierSchema>;

// Single investigation policy
export const InvestigationPolicySchema = z.object({
	tier: TierSchema,
	autoInvestigate: AutoInvestigateModeSchema,
	requiresApproval: z.boolean(),
	pageOnCall: z.boolean(),
	postToSlack: z.boolean(),
});
export type InvestigationPolicy = z.infer<typeof InvestigationPolicySchema>;

// All policies response
export const AllInvestigationPoliciesSchema = z.object({
	policies: z.array(InvestigationPolicySchema),
});
export type AllInvestigationPolicies = z.infer<
	typeof AllInvestigationPoliciesSchema
>;

// Update policy input (tier comes from path param)
export const UpdateInvestigationPolicySchema = z.object({
	tier: TierSchema,
	autoInvestigate: AutoInvestigateModeSchema.optional(),
	requiresApproval: z.boolean().optional(),
	pageOnCall: z.boolean().optional(),
	postToSlack: z.boolean().optional(),
});
export type UpdateInvestigationPolicy = z.infer<
	typeof UpdateInvestigationPolicySchema
>;

// Investigation limits
export const InvestigationLimitsSchema = z.object({
	maxConcurrent: z.number().int().min(1).max(100),
	timeoutMinutes: z.number().int().min(1).max(120),
	maxToolCalls: z.number().int().min(1).max(500),
});
export type InvestigationLimits = z.infer<typeof InvestigationLimitsSchema>;

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
 * Per-tier investigation trigger configuration
 * Based on BigPanda pattern: critical incidents need immediate attention
 */
export const InvestigationTriggerSchema = z.object({
	/** Service tier this trigger applies to */
	tier: TierSchema,
	/** When to auto-investigate */
	autoInvestigate: AutoInvestigateModeSchema,
	/** Number of alerts before triggering investigation (1-100) */
	triggerOnAlertCount: z.number().int().min(1).max(100).default(3),
	/** Severities that trigger auto-investigation */
	triggerOnSeverities: z
		.array(z.enum(["critical", "high"]))
		.default(["critical"]),
	/** Delay in minutes before triggering (to allow alert correlation) */
	triggerDelayMinutes: z.number().int().min(0).max(60).default(5),
	/** Re-investigate when new alerts are added after completion */
	reInvestigateOnNewAlerts: z.boolean().default(false),
	/** Number of new alerts to trigger re-investigation */
	reInvestigateThreshold: z.number().int().min(1).max(50).default(5),
});
export type InvestigationTrigger = z.infer<typeof InvestigationTriggerSchema>;

/**
 * All investigation triggers response
 */
export const AllInvestigationTriggersSchema = z.object({
	triggers: z.array(InvestigationTriggerSchema),
});
export type AllInvestigationTriggers = z.infer<
	typeof AllInvestigationTriggersSchema
>;

/**
 * Update investigation trigger input
 */
export const UpdateInvestigationTriggerSchema = z.object({
	tier: TierSchema,
	autoInvestigate: AutoInvestigateModeSchema.optional(),
	triggerOnAlertCount: z.number().int().min(1).max(100).optional(),
	triggerOnSeverities: z.array(z.enum(["critical", "high"])).optional(),
	triggerDelayMinutes: z.number().int().min(0).max(60).optional(),
	reInvestigateOnNewAlerts: z.boolean().optional(),
	reInvestigateThreshold: z.number().int().min(1).max(50).optional(),
});
export type UpdateInvestigationTrigger = z.infer<
	typeof UpdateInvestigationTriggerSchema
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

// Update limits
export const UpdateInvestigationLimitsSchema = z.object({
	maxConcurrent: z.number().int().min(1).max(100).optional(),
	timeoutMinutes: z.number().int().min(1).max(120).optional(),
	maxToolCalls: z.number().int().min(1).max(500).optional(),
});
export type UpdateInvestigationLimits = z.infer<
	typeof UpdateInvestigationLimitsSchema
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
