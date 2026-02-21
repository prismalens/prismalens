/**
 * Common schemas shared across all entities
 * Includes enums, pagination, and utility schemas
 */
import { AGENT_IDS } from "@prismalens/config/agents";
import { z } from "zod";

// =============================================================================
// ENUMS - Mirroring Prisma schema enums
// =============================================================================

// User & Access Control
export const GlobalRoleSchema = z.enum(["owner", "admin", "member"]);

// Service Catalog
export const ServiceTypeSchema = z.enum([
	"service",
	"database",
	"queue",
	"cache",
	"gateway",
	"external",
	"infrastructure",
]);

export const ServiceTierSchema = z.enum([
	"tier_1",
	"tier_2",
	"tier_3",
	"tier_4",
]);

/**
 * Service tier metadata with human-readable labels and descriptions.
 * Used across frontend and backend for consistent tier display.
 */
export const SERVICE_TIER_METADATA: Record<
	z.infer<typeof ServiceTierSchema>,
	{ name: string; shortName: string; description: string }
> = {
	tier_1: {
		name: "Tier 1 - Critical",
		shortName: "Critical",
		description: "Production-critical services requiring immediate response",
	},
	tier_2: {
		name: "Tier 2 - High",
		shortName: "High",
		description: "Important business services, response within hours",
	},
	tier_3: {
		name: "Tier 3 - Medium",
		shortName: "Medium",
		description: "Supporting services with standard SLA",
	},
	tier_4: {
		name: "Tier 4 - Low",
		shortName: "Low",
		description: "Non-critical services, best-effort response",
	},
};

export const DependencyTypeSchema = z.enum(["runtime", "build", "data"]);

export const DependencyCriticalitySchema = z.enum([
	"required",
	"optional",
	"degraded",
]);

// Alerts & Incidents
export const SeveritySchema = z.enum([
	"critical",
	"high",
	"medium",
	"low",
	"info",
]);

export const AlertStatusSchema = z.enum([
	"triggered",
	"acknowledged",
	"correlated",
	"resolved",
	"suppressed",
]);

export const IncidentStatusSchema = z.enum([
	"triggered",
	"investigating",
	"identified",
	"monitoring",
	"resolved",
	"closed",
]);

export const PrioritySchema = z.enum(["p1", "p2", "p3", "p4", "p5"]);

// Investigation & Workflow
export const WorkflowStatusSchema = z.enum([
	"pending",
	"running",
	"completed",
	"failed",
	"cancelled",
]);

export const RootCauseCategorySchema = z.enum([
	"code",
	"config",
	"infrastructure",
	"external",
	"unknown",
]);

export const AgentNameSchema = z.enum(AGENT_IDS);

export const AgentTypeSchema = z.enum(["llm", "sequential", "loop"]);

export const ExecutionStatusSchema = z.enum([
	"pending",
	"running",
	"completed",
	"failed",
]);

export const ToolExecutionStatusSchema = z.enum([
	"pending",
	"running",
	"success",
	"error",
]);

export const ToolCategorySchema = z.enum([
	"file",
	"search",
	"github",
	"logs",
	"analysis",
]);

// Recommendations
export const RecommendationPrioritySchema = z.enum([
	"critical",
	"high",
	"medium",
	"low",
]);

export const RecommendationCategorySchema = z.enum([
	"code_fix",
	"config_change",
	"rollback",
	"monitoring",
	"investigation",
]);

export const UrgencySchema = z.enum(["immediate", "short_term", "long_term"]);

export const EffortEstimateSchema = z.enum(["minutes", "hours", "days"]);

export const RecommendationStatusSchema = z.enum([
	"pending",
	"in_progress",
	"completed",
	"rejected",
	"deferred",
]);

// Timeline
export const TimelineEntryTypeSchema = z.enum([
	"incident_created",
	"alert_added",
	"alert_removed",
	"status_changed",
	"severity_changed",
	"assigned",
	"investigation_started",
	"investigation_completed",
	"recommendation_added",
	"recommendation_completed",
	"comment",
	"postmortem_created",
	"custom",
]);

export const TimelineSourceSchema = z.enum(["system", "user", "ai_worker"]);

// Postmortem
export const PostmortemStatusSchema = z.enum([
	"draft",
	"in_review",
	"published",
	"archived",
]);

// Correlation
export const CorrelationActionSchema = z.enum([
	"correlate",
	"suppress",
	"create_incident",
]);

// Settings
export const SettingTypeSchema = z.enum([
	"string",
	"number",
	"boolean",
	"json",
	"encrypted",
]);

export const SettingCategorySchema = z.enum([
	"general",
	"correlation",
	"ai",
	"notifications",
	"setup",
]);

// Integrations
export const ConnectionStatusSchema = z.enum([
	"pending",
	"connected",
	"error",
	"disabled",
]);

export const AuthMethodSchema = z.enum(["api_key", "oauth2"]);

// Service Discovery
export const SuggestionStatusSchema = z.enum([
	"pending",
	"accepted",
	"rejected",
	"ignored",
]);

// Change Tracking
export const ChangeEventTypeSchema = z.enum([
	"deployment",
	"config",
	"migration",
	"commit",
	"rollback",
]);

// License
export const LicenseTypeSchema = z.enum(["none", "subscription"]);

export const LicenseTierSchema = z.enum(["community", "enterprise"]);

// =============================================================================
// PAGINATION & COMMON QUERY SCHEMAS
// =============================================================================

export const PaginationSchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

export const IdParamSchema = z.object({
	id: z.string().uuid(),
});

// =============================================================================
// DATE HANDLING
// =============================================================================

// For API responses - dates are serialized as ISO strings
export const DateStringSchema = z.string().datetime();

// For coercing string dates to Date objects when needed
export const CoerceDateSchema = z.coerce.date();

// =============================================================================
// COMMON RESPONSE SCHEMAS
// =============================================================================

export const SuccessResponseSchema = z.object({
	success: z.boolean(),
});

export const MessageResponseSchema = z.object({
	message: z.string(),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type GlobalRole = z.infer<typeof GlobalRoleSchema>;
export type ServiceType = z.infer<typeof ServiceTypeSchema>;
export type ServiceTier = z.infer<typeof ServiceTierSchema>;
export type DependencyType = z.infer<typeof DependencyTypeSchema>;
export type DependencyCriticality = z.infer<typeof DependencyCriticalitySchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type AlertStatus = z.infer<typeof AlertStatusSchema>;
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
export type RootCauseCategory = z.infer<typeof RootCauseCategorySchema>;
export type AgentName = z.infer<typeof AgentNameSchema>;
export type AgentType = z.infer<typeof AgentTypeSchema>;
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;
export type ToolExecutionStatus = z.infer<typeof ToolExecutionStatusSchema>;
export type ToolCategory = z.infer<typeof ToolCategorySchema>;
export type RecommendationPriority = z.infer<
	typeof RecommendationPrioritySchema
>;
export type RecommendationCategory = z.infer<
	typeof RecommendationCategorySchema
>;
export type Urgency = z.infer<typeof UrgencySchema>;
export type EffortEstimate = z.infer<typeof EffortEstimateSchema>;
export type RecommendationStatus = z.infer<typeof RecommendationStatusSchema>;
export type TimelineEntryType = z.infer<typeof TimelineEntryTypeSchema>;
export type TimelineSource = z.infer<typeof TimelineSourceSchema>;
export type PostmortemStatus = z.infer<typeof PostmortemStatusSchema>;
export type CorrelationAction = z.infer<typeof CorrelationActionSchema>;
export type SettingType = z.infer<typeof SettingTypeSchema>;
export type SettingCategory = z.infer<typeof SettingCategorySchema>;
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;
export type AuthMethod = z.infer<typeof AuthMethodSchema>;
export type SuggestionStatus = z.infer<typeof SuggestionStatusSchema>;
export type ChangeEventType = z.infer<typeof ChangeEventTypeSchema>;
export type LicenseType = z.infer<typeof LicenseTypeSchema>;
export type LicenseTier = z.infer<typeof LicenseTierSchema>;
export type Pagination = z.infer<typeof PaginationSchema>;
