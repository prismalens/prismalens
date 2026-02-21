/**
 * Shared Enums for PrismaLens API
 *
 * Derived from @prismalens/contracts/schemas (SSOT).
 * Runtime enum objects are compatible with class-validator @IsEnum() decorator.
 *
 * @module shared/enums
 */
import {
	GlobalRoleSchema,
	ServiceTypeSchema,
	ServiceTierSchema,
	DependencyTypeSchema,
	DependencyCriticalitySchema,
	SeveritySchema,
	AlertStatusSchema,
	IncidentStatusSchema,
	PrioritySchema,
	WorkflowStatusSchema,
	RootCauseCategorySchema,
	AgentTypeSchema,
	ExecutionStatusSchema,
	ToolExecutionStatusSchema,
	ToolCategorySchema,
	RecommendationPrioritySchema,
	RecommendationCategorySchema,
	UrgencySchema,
	EffortEstimateSchema,
	RecommendationStatusSchema,
	TimelineEntryTypeSchema,
	TimelineSourceSchema,
	PostmortemStatusSchema,
	CorrelationActionSchema,
	SettingTypeSchema,
	SettingCategorySchema,
	ConnectionStatusSchema,
	AuthMethodSchema,
	SuggestionStatusSchema,
} from "@prismalens/contracts/schemas";

// =============================================================================
// RUNTIME ENUM OBJECTS — compatible with @IsEnum() decorator
// =============================================================================

// User & Access Control
export const GlobalRole = GlobalRoleSchema.enum;

// Service Catalog
export const ServiceType = ServiceTypeSchema.enum;
export const ServiceTier = ServiceTierSchema.enum;
export const DependencyType = DependencyTypeSchema.enum;
export const DependencyCriticality = DependencyCriticalitySchema.enum;

// Alerts & Incidents
export const Severity = SeveritySchema.enum;
export const AlertStatus = AlertStatusSchema.enum;
export const IncidentStatus = IncidentStatusSchema.enum;
export const Priority = PrioritySchema.enum;

// Investigation & Workflow
export const WorkflowStatus = WorkflowStatusSchema.enum;
export const RootCauseCategory = RootCauseCategorySchema.enum;
export const AgentType = AgentTypeSchema.enum;
export const ExecutionStatus = ExecutionStatusSchema.enum;
export const ToolExecutionStatus = ToolExecutionStatusSchema.enum;
export const ToolCategory = ToolCategorySchema.enum;

// Recommendations
export const RecommendationPriority = RecommendationPrioritySchema.enum;
export const RecommendationCategory = RecommendationCategorySchema.enum;
export const Urgency = UrgencySchema.enum;
export const EffortEstimate = EffortEstimateSchema.enum;
export const RecommendationStatus = RecommendationStatusSchema.enum;

// Timeline
export const TimelineEntryType = TimelineEntryTypeSchema.enum;
export const TimelineSource = TimelineSourceSchema.enum;

// Postmortem
export const PostmortemStatus = PostmortemStatusSchema.enum;

// Correlation
export const CorrelationAction = CorrelationActionSchema.enum;

// Settings
export const SettingType = SettingTypeSchema.enum;
export const SettingCategory = SettingCategorySchema.enum;

// Integrations
export const ConnectionStatus = ConnectionStatusSchema.enum;
export const AuthMethod = AuthMethodSchema.enum;

// Service Discovery
export const SuggestionStatus = SuggestionStatusSchema.enum;

// =============================================================================
// TYPE EXPORTS — derived from the const objects above
// =============================================================================

export type GlobalRole = (typeof GlobalRole)[keyof typeof GlobalRole];
export type ServiceType = (typeof ServiceType)[keyof typeof ServiceType];
export type ServiceTier = (typeof ServiceTier)[keyof typeof ServiceTier];
export type DependencyType = (typeof DependencyType)[keyof typeof DependencyType];
export type DependencyCriticality = (typeof DependencyCriticality)[keyof typeof DependencyCriticality];
export type Severity = (typeof Severity)[keyof typeof Severity];
export type AlertStatus = (typeof AlertStatus)[keyof typeof AlertStatus];
export type IncidentStatus = (typeof IncidentStatus)[keyof typeof IncidentStatus];
export type Priority = (typeof Priority)[keyof typeof Priority];
export type WorkflowStatus = (typeof WorkflowStatus)[keyof typeof WorkflowStatus];
export type RootCauseCategory = (typeof RootCauseCategory)[keyof typeof RootCauseCategory];
export type AgentType = (typeof AgentType)[keyof typeof AgentType];
export type ExecutionStatus = (typeof ExecutionStatus)[keyof typeof ExecutionStatus];
export type ToolExecutionStatus = (typeof ToolExecutionStatus)[keyof typeof ToolExecutionStatus];
export type ToolCategory = (typeof ToolCategory)[keyof typeof ToolCategory];
export type RecommendationPriority = (typeof RecommendationPriority)[keyof typeof RecommendationPriority];
export type RecommendationCategory = (typeof RecommendationCategory)[keyof typeof RecommendationCategory];
export type Urgency = (typeof Urgency)[keyof typeof Urgency];
export type EffortEstimate = (typeof EffortEstimate)[keyof typeof EffortEstimate];
export type RecommendationStatus = (typeof RecommendationStatus)[keyof typeof RecommendationStatus];
export type TimelineEntryType = (typeof TimelineEntryType)[keyof typeof TimelineEntryType];
export type TimelineSource = (typeof TimelineSource)[keyof typeof TimelineSource];
export type PostmortemStatus = (typeof PostmortemStatus)[keyof typeof PostmortemStatus];
export type CorrelationAction = (typeof CorrelationAction)[keyof typeof CorrelationAction];
export type SettingType = (typeof SettingType)[keyof typeof SettingType];
export type SettingCategory = (typeof SettingCategory)[keyof typeof SettingCategory];
export type ConnectionStatus = (typeof ConnectionStatus)[keyof typeof ConnectionStatus];
export type AuthMethod = (typeof AuthMethod)[keyof typeof AuthMethod];
export type SuggestionStatus = (typeof SuggestionStatus)[keyof typeof SuggestionStatus];
