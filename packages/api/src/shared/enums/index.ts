// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Shared Enums for PrismaLens API
 *
 * Derived from @prismalens/contracts/schemas (SSOT).
 * Runtime enum objects are compatible with class-validator @IsEnum() decorator.
 *
 * @module shared/enums
 */
import {
	AgentTypeSchema,
	AlertStatusSchema,
	CorrelationActionSchema,
	DependencyCriticalitySchema,
	DependencyTypeSchema,
	EffortEstimateSchema,
	ExecutionStatusSchema,
	IncidentStatusSchema,
	PrioritySchema,
	RecommendationCategorySchema,
	RecommendationPrioritySchema,
	RecommendationStatusSchema,
	RootCauseCategorySchema,
	ServiceTierSchema,
	ServiceTypeSchema,
	SeveritySchema,
	TimelineEntryTypeSchema,
	TimelineSourceSchema,
	ToolCategorySchema,
	ToolExecutionStatusSchema,
	UrgencySchema,
	WorkflowStatusSchema,
} from "@prismalens/contracts/schemas";

type ExtractEnumValues<S> = S extends { enum: readonly (infer V)[] }
	? V & string
	: S extends { enum: Record<string, infer V> }
		? V & string
		: S extends { options: readonly (infer V)[] }
			? V & string
			: string;

type EnumObject<S> = {
	[K in ExtractEnumValues<S>]: K;
};

// =============================================================================
// RUNTIME ENUM OBJECTS — compatible with @IsEnum() decorator
// =============================================================================

// Service Catalog
export const ServiceType = ServiceTypeSchema.enum as unknown as EnumObject<
	typeof ServiceTypeSchema
>;
export const ServiceTier = ServiceTierSchema.enum as unknown as EnumObject<
	typeof ServiceTierSchema
>;
export const DependencyType =
	DependencyTypeSchema.enum as unknown as EnumObject<
		typeof DependencyTypeSchema
	>;
export const DependencyCriticality =
	DependencyCriticalitySchema.enum as unknown as EnumObject<
		typeof DependencyCriticalitySchema
	>;

// Alerts & Incidents
export const Severity = SeveritySchema.enum as unknown as EnumObject<
	typeof SeveritySchema
>;
export const AlertStatus = AlertStatusSchema.enum as unknown as EnumObject<
	typeof AlertStatusSchema
>;
export const IncidentStatus =
	IncidentStatusSchema.enum as unknown as EnumObject<
		typeof IncidentStatusSchema
	>;
export const Priority = PrioritySchema.enum as unknown as EnumObject<
	typeof PrioritySchema
>;

// Investigation & Workflow
export const WorkflowStatus =
	WorkflowStatusSchema.enum as unknown as EnumObject<
		typeof WorkflowStatusSchema
	>;
export const RootCauseCategory =
	RootCauseCategorySchema.enum as unknown as EnumObject<
		typeof RootCauseCategorySchema
	>;
export const AgentType = AgentTypeSchema.enum as unknown as EnumObject<
	typeof AgentTypeSchema
>;
export const ExecutionStatus =
	ExecutionStatusSchema.enum as unknown as EnumObject<
		typeof ExecutionStatusSchema
	>;
export const ToolExecutionStatus =
	ToolExecutionStatusSchema.enum as unknown as EnumObject<
		typeof ToolExecutionStatusSchema
	>;
export const ToolCategory = ToolCategorySchema.enum as unknown as EnumObject<
	typeof ToolCategorySchema
>;

// Recommendations
export const RecommendationPriority =
	RecommendationPrioritySchema.enum as unknown as EnumObject<
		typeof RecommendationPrioritySchema
	>;
export const RecommendationCategory =
	RecommendationCategorySchema.enum as unknown as EnumObject<
		typeof RecommendationCategorySchema
	>;
export const Urgency = UrgencySchema.enum as unknown as EnumObject<
	typeof UrgencySchema
>;
export const EffortEstimate =
	EffortEstimateSchema.enum as unknown as EnumObject<
		typeof EffortEstimateSchema
	>;
export const RecommendationStatus =
	RecommendationStatusSchema.enum as unknown as EnumObject<
		typeof RecommendationStatusSchema
	>;

// Timeline
export const TimelineEntryType =
	TimelineEntryTypeSchema.enum as unknown as EnumObject<
		typeof TimelineEntryTypeSchema
	>;
export const TimelineSource =
	TimelineSourceSchema.enum as unknown as EnumObject<
		typeof TimelineSourceSchema
	>;

// Correlation
export const CorrelationAction =
	CorrelationActionSchema.enum as unknown as EnumObject<
		typeof CorrelationActionSchema
	>;

// =============================================================================
// TYPE EXPORTS — derived from the const objects above
// =============================================================================

export type ServiceType = (typeof ServiceType)[keyof typeof ServiceType];
export type ServiceTier = (typeof ServiceTier)[keyof typeof ServiceTier];
export type DependencyType =
	(typeof DependencyType)[keyof typeof DependencyType];
export type DependencyCriticality =
	(typeof DependencyCriticality)[keyof typeof DependencyCriticality];
export type Severity = (typeof Severity)[keyof typeof Severity];
export type AlertStatus = (typeof AlertStatus)[keyof typeof AlertStatus];
export type IncidentStatus =
	(typeof IncidentStatus)[keyof typeof IncidentStatus];
export type Priority = (typeof Priority)[keyof typeof Priority];
export type WorkflowStatus =
	(typeof WorkflowStatus)[keyof typeof WorkflowStatus];
export type RootCauseCategory =
	(typeof RootCauseCategory)[keyof typeof RootCauseCategory];
export type AgentType = (typeof AgentType)[keyof typeof AgentType];
export type ExecutionStatus =
	(typeof ExecutionStatus)[keyof typeof ExecutionStatus];
export type ToolExecutionStatus =
	(typeof ToolExecutionStatus)[keyof typeof ToolExecutionStatus];
export type ToolCategory = (typeof ToolCategory)[keyof typeof ToolCategory];
export type RecommendationPriority =
	(typeof RecommendationPriority)[keyof typeof RecommendationPriority];
export type RecommendationCategory =
	(typeof RecommendationCategory)[keyof typeof RecommendationCategory];
export type Urgency = (typeof Urgency)[keyof typeof Urgency];
export type EffortEstimate =
	(typeof EffortEstimate)[keyof typeof EffortEstimate];
export type RecommendationStatus =
	(typeof RecommendationStatus)[keyof typeof RecommendationStatus];
export type TimelineEntryType =
	(typeof TimelineEntryType)[keyof typeof TimelineEntryType];
export type TimelineSource =
	(typeof TimelineSource)[keyof typeof TimelineSource];
export type CorrelationAction =
	(typeof CorrelationAction)[keyof typeof CorrelationAction];
