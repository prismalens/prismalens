/**
 * Settings schemas for LLM configuration
 */
import { z } from "zod";

// Provider ID schema
export const LlmProviderIdSchema = z.enum([
	"anthropic",
	"openai",
	"google",
	"ollama",
]);
export type LlmProviderId = z.infer<typeof LlmProviderIdSchema>;

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
