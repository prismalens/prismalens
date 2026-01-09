/**
 * Shared Enums for PrismaLens API
 *
 * These enums mirror the Prisma schema enums and are used across the application
 * for type-safe validation in DTOs, services, and controllers.
 *
 * @module shared/enums
 */

// =============================================================================
// USER & ACCESS CONTROL
// =============================================================================

/** User roles for access control */
export enum GlobalRole {
	OWNER = "owner",
	ADMIN = "admin",
	MEMBER = "member",
}

// =============================================================================
// SERVICE CATALOG
// =============================================================================

/** Service types for the service catalog */
export enum ServiceType {
	SERVICE = "service",
	DATABASE = "database",
	QUEUE = "queue",
	CACHE = "cache",
	GATEWAY = "gateway",
	EXTERNAL = "external",
	INFRASTRUCTURE = "infrastructure",
}

/** Service tiers for prioritization */
export enum ServiceTier {
	TIER_1 = "tier_1",
	TIER_2 = "tier_2",
	TIER_3 = "tier_3",
	TIER_4 = "tier_4",
}

/** Dependency types between services */
export enum DependencyType {
	RUNTIME = "runtime",
	BUILD = "build",
	DATA = "data",
}

/** Dependency criticality levels */
export enum DependencyCriticality {
	REQUIRED = "required",
	OPTIONAL = "optional",
	DEGRADED = "degraded",
}

// =============================================================================
// ALERTS & INCIDENTS
// =============================================================================

/** Severity levels for alerts and incidents */
export enum Severity {
	CRITICAL = "critical",
	HIGH = "high",
	MEDIUM = "medium",
	LOW = "low",
	INFO = "info",
}

/** Alert status lifecycle */
export enum AlertStatus {
	TRIGGERED = "triggered",
	ACKNOWLEDGED = "acknowledged",
	CORRELATED = "correlated",
	RESOLVED = "resolved",
	SUPPRESSED = "suppressed",
}

/** Incident status lifecycle */
export enum IncidentStatus {
	TRIGGERED = "triggered",
	INVESTIGATING = "investigating",
	IDENTIFIED = "identified",
	MONITORING = "monitoring",
	RESOLVED = "resolved",
	CLOSED = "closed",
}

/** Priority levels for incidents */
export enum Priority {
	P1 = "p1",
	P2 = "p2",
	P3 = "p3",
	P4 = "p4",
	P5 = "p5",
}

// =============================================================================
// INVESTIGATION & WORKFLOW
// =============================================================================

/** Investigation/workflow status */
export enum WorkflowStatus {
	PENDING = "pending",
	RUNNING = "running",
	COMPLETED = "completed",
	FAILED = "failed",
	CANCELLED = "cancelled",
}

/** Root cause categories */
export enum RootCauseCategory {
	CODE = "code",
	CONFIG = "config",
	INFRASTRUCTURE = "infrastructure",
	EXTERNAL = "external",
	UNKNOWN = "unknown",
}

/** Agent types */
export enum AgentType {
	LLM = "llm",
	SEQUENTIAL = "sequential",
	LOOP = "loop",
}

/** Execution status for agents */
export enum ExecutionStatus {
	PENDING = "pending",
	RUNNING = "running",
	COMPLETED = "completed",
	FAILED = "failed",
}

/** Tool execution status */
export enum ToolExecutionStatus {
	PENDING = "pending",
	RUNNING = "running",
	SUCCESS = "success",
	ERROR = "error",
}

/** Tool categories */
export enum ToolCategory {
	FILE = "file",
	SEARCH = "search",
	GITHUB = "github",
	LOGS = "logs",
	ANALYSIS = "analysis",
}

// =============================================================================
// RECOMMENDATIONS
// =============================================================================

/** Recommendation priority */
export enum RecommendationPriority {
	CRITICAL = "critical",
	HIGH = "high",
	MEDIUM = "medium",
	LOW = "low",
}

/** Recommendation categories */
export enum RecommendationCategory {
	CODE_FIX = "code_fix",
	CONFIG_CHANGE = "config_change",
	ROLLBACK = "rollback",
	MONITORING = "monitoring",
	INVESTIGATION = "investigation",
}

/** Recommendation urgency */
export enum Urgency {
	IMMEDIATE = "immediate",
	SHORT_TERM = "short_term",
	LONG_TERM = "long_term",
}

/** Effort estimates */
export enum EffortEstimate {
	MINUTES = "minutes",
	HOURS = "hours",
	DAYS = "days",
}

/** Recommendation status */
export enum RecommendationStatus {
	PENDING = "pending",
	IN_PROGRESS = "in_progress",
	COMPLETED = "completed",
	REJECTED = "rejected",
	DEFERRED = "deferred",
}

// =============================================================================
// TIMELINE
// =============================================================================

/** Timeline entry types */
export enum TimelineEntryType {
	INCIDENT_CREATED = "incident_created",
	ALERT_ADDED = "alert_added",
	ALERT_REMOVED = "alert_removed",
	STATUS_CHANGED = "status_changed",
	SEVERITY_CHANGED = "severity_changed",
	ASSIGNED = "assigned",
	INVESTIGATION_STARTED = "investigation_started",
	INVESTIGATION_COMPLETED = "investigation_completed",
	RECOMMENDATION_ADDED = "recommendation_added",
	RECOMMENDATION_COMPLETED = "recommendation_completed",
	COMMENT = "comment",
	POSTMORTEM_CREATED = "postmortem_created",
	CUSTOM = "custom",
}

/** Timeline entry source */
export enum TimelineSource {
	SYSTEM = "system",
	USER = "user",
	AI_WORKER = "ai_worker",
}

// =============================================================================
// POSTMORTEM
// =============================================================================

/** Postmortem status */
export enum PostmortemStatus {
	DRAFT = "draft",
	IN_REVIEW = "in_review",
	PUBLISHED = "published",
	ARCHIVED = "archived",
}

// =============================================================================
// CORRELATION
// =============================================================================

/** Correlation rule actions */
export enum CorrelationAction {
	CORRELATE = "correlate",
	SUPPRESS = "suppress",
	CREATE_INCIDENT = "create_incident",
}

// =============================================================================
// SETTINGS
// =============================================================================

/** Setting value types */
export enum SettingType {
	STRING = "string",
	NUMBER = "number",
	BOOLEAN = "boolean",
	JSON = "json",
}

/** Setting categories */
export enum SettingCategory {
	GENERAL = "general",
	CORRELATION = "correlation",
	AI = "ai",
	NOTIFICATIONS = "notifications",
}

// =============================================================================
// INTEGRATIONS
// =============================================================================

/** Integration connection status */
export enum ConnectionStatus {
	PENDING = "pending",
	CONNECTED = "connected",
	ERROR = "error",
	DISABLED = "disabled",
}

/** Authentication methods */
export enum AuthMethod {
	API_KEY = "api_key",
	OAUTH2 = "oauth2",
}

// =============================================================================
// SERVICE DISCOVERY
// =============================================================================

/** Service suggestion status */
export enum SuggestionStatus {
	PENDING = "pending",
	ACCEPTED = "accepted",
	REJECTED = "rejected",
	IGNORED = "ignored",
}
