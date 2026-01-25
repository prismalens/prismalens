/**
 * Settings schemas for LLM configuration
 */
import {
	llmProviderIdSchema,
	type LLMProviderId,
} from "@prismalens/config/llm";
import {
	agentIdSchema,
	type AgentId as AgentIdType,
} from "@prismalens/agents/browser";
import { z } from "zod";

// =============================================================================
// PROVIDER & AGENT SCHEMAS (imported from source packages)
// =============================================================================

/**
 * Provider ID schema - imported from @prismalens/config
 * Re-exported for backwards compatibility
 */
export const LlmProviderIdSchema = llmProviderIdSchema;
export type LlmProviderId = LLMProviderId;

// Provider param for routes
export const ProviderParamSchema = z.object({
	provider: z.string().min(1),
});

// Update LLM configuration schema
export const UpdateLlmConfigSchema = z.object({
	apiKey: z.string().optional(),
	model: z.string().optional(),
	baseUrl: z.string().url().optional(),
	// Common LangChain config fields
	temperature: z.number().min(0).max(2).optional(),
	maxTokens: z.number().int().min(1).optional(),
	topP: z.number().min(0).max(1).optional(),
	// Provider-specific fields
	topK: z.number().int().min(1).optional(),
	frequencyPenalty: z.number().min(-2).max(2).optional(),
	presencePenalty: z.number().min(-2).max(2).optional(),
	stopSequences: z.array(z.string()).optional(),
});
export type UpdateLlmConfig = z.infer<typeof UpdateLlmConfigSchema>;

// LLM config response (for single provider)
export const LlmConfigResponseSchema = z.object({
	apiKey: z.string(), // Always masked as "********"
	model: z.string().optional(),
	baseUrl: z.string().optional(),
	temperature: z.number().optional(),
	maxTokens: z.number().optional(),
	topP: z.number().optional(),
	topK: z.number().optional(),
	frequencyPenalty: z.number().optional(),
	presencePenalty: z.number().optional(),
	stopSequences: z.array(z.string()).optional(),
});
export type LlmConfigResponse = z.infer<typeof LlmConfigResponseSchema>;

// Provider summary (for list)
export const LlmProviderSummarySchema = z.object({
	provider: z.string(),
	model: z.string().optional(),
	hasApiKey: z.boolean(),
	baseUrl: z.string().optional(),
});
export type LlmProviderSummary = z.infer<typeof LlmProviderSummarySchema>;

// All LLM configs response
export const AllLlmConfigsResponseSchema = z.object({
	activeProvider: z.string().nullable(),
	providers: z.array(LlmProviderSummarySchema),
});
export type AllLlmConfigsResponse = z.infer<typeof AllLlmConfigsResponseSchema>;

// Set active provider schema
export const SetActiveProviderSchema = z.object({
	provider: z.string().min(1),
});
export type SetActiveProvider = z.infer<typeof SetActiveProviderSchema>;

// Test connection result
export const TestLlmResultSchema = z.object({
	success: z.boolean(),
	error: z.string().optional(),
});
export type TestLlmResult = z.infer<typeof TestLlmResultSchema>;

// Setting record (raw from DB)
export const SettingRecordSchema = z.object({
	id: z.string(),
	key: z.string(),
	value: z.string(),
	type: z.string(),
	category: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type SettingRecord = z.infer<typeof SettingRecordSchema>;

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

// =============================================================================
// COMPREHENSIVE LLM CONFIGURATION (ENV-ONLY API KEYS)
// =============================================================================

/**
 * Extended provider IDs - imported from @prismalens/config
 * (Same as LlmProviderIdSchema, kept for backwards compatibility)
 */
export const LlmProviderIdExtendedSchema = llmProviderIdSchema;
export type LlmProviderIdExtended = LLMProviderId;

/**
 * Agent IDs for per-agent overrides - imported from @prismalens/agents
 */
export const AgentIdSchema = agentIdSchema;
export type AgentId = AgentIdType;

/**
 * Per-provider configuration stored in DB
 * Note: API keys are NOT stored - they come from env vars only
 */
export const LlmProviderConfigSchema = z.object({
	model: z.string(),
	temperature: z.number().min(0).max(2).optional(),
	maxTokens: z.number().int().min(1).optional(),
	baseUrl: z.string().optional(), // Ollama only
	// Advanced options as JSON - provider-specific fields not covered by common options
	advancedOptions: z.record(z.unknown()).optional(),
});
export type LlmProviderConfig = z.infer<typeof LlmProviderConfigSchema>;

/**
 * Per-agent override configuration
 */
export const AgentOverrideConfigSchema = z.object({
	model: z.string().optional(),
	temperature: z.number().min(0).max(2).optional(),
	advancedOptions: z.record(z.unknown()).optional(),
});
export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>;

/**
 * Full LLM settings structure stored in DB
 */
export const LlmSettingsSchema = z.object({
	activeProvider: LlmProviderIdExtendedSchema.nullable(),
	providers: z.record(LlmProviderIdExtendedSchema, LlmProviderConfigSchema),
	agentOverrides: z
		.record(AgentIdSchema, AgentOverrideConfigSchema)
		.optional(),
});
export type LlmSettings = z.infer<typeof LlmSettingsSchema>;

/**
 * Environment variable status for a provider (read-only)
 */
export const LlmProviderEnvStatusSchema = z.object({
	hasApiKey: z.boolean(),
	envVarName: z.string().nullable(),
	isReady: z.boolean(), // hasApiKey || provider doesn't need key (ollama)
});
export type LlmProviderEnvStatus = z.infer<typeof LlmProviderEnvStatusSchema>;

/**
 * Full environment status response
 */
export const LlmEnvStatusResponseSchema = z.object({
	providers: z.record(LlmProviderIdExtendedSchema, LlmProviderEnvStatusSchema),
	activeEnvProvider: z.string().nullable(), // From LLM_PROVIDER env var
});
export type LlmEnvStatusResponse = z.infer<typeof LlmEnvStatusResponseSchema>;

/**
 * Update LLM settings input
 */
export const UpdateLlmSettingsSchema = z.object({
	activeProvider: LlmProviderIdExtendedSchema.optional(),
	providers: z
		.record(LlmProviderIdExtendedSchema, LlmProviderConfigSchema.partial())
		.optional(),
	agentOverrides: z
		.record(AgentIdSchema, AgentOverrideConfigSchema)
		.optional(),
});
export type UpdateLlmSettings = z.infer<typeof UpdateLlmSettingsSchema>;

/**
 * Model metadata from models registry
 */
export const ModelMetadataSchema = z.object({
	id: z.string(),
	name: z.string(),
	provider: z.string(),
	cost: z.object({
		input: z.number(),
		output: z.number(),
	}),
	limit: z.object({
		context: z.number(),
		output: z.number(),
	}),
	toolCall: z.boolean(),
	reasoning: z.boolean(),
	modalities: z.object({
		input: z.array(z.string()),
		output: z.array(z.string()),
	}),
	releaseDate: z.string().optional(), // ISO date string for sorting (newest first)
});
export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;

/**
 * Models list response
 */
export const ModelsListResponseSchema = z.object({
	models: z.array(ModelMetadataSchema),
});
export type ModelsListResponse = z.infer<typeof ModelsListResponseSchema>;

/**
 * Test LLM connection input - uses env var for API key
 */
export const TestLlmConnectionInputSchema = z.object({
	provider: LlmProviderIdExtendedSchema,
	model: z.string().optional(),
});
export type TestLlmConnectionInput = z.infer<typeof TestLlmConnectionInputSchema>;

// =============================================================================
// MCP SERVER CONFIGURATION
// =============================================================================

import { mcpServerIdSchema, type MCPServerId } from "@prismalens/config/mcp";

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
	servers: z.record(McpServerIdSchema, McpServerSettingsSchema),
});
export type McpSettings = z.infer<typeof McpSettingsSchema>;

/**
 * Update MCP settings input (partial update)
 */
export const UpdateMcpSettingsSchema = z.object({
	servers: z
		.record(McpServerIdSchema, McpServerSettingsSchema.partial())
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
export type TestMcpConnectionInput = z.infer<typeof TestMcpConnectionInputSchema>;

/**
 * Test MCP connection result
 */
export const TestMcpResultSchema = z.object({
	success: z.boolean(),
	error: z.string().optional(),
	toolCount: z.number().optional(),
});
export type TestMcpResult = z.infer<typeof TestMcpResultSchema>;
