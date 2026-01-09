export declare const GlobalRole: {
	readonly owner: "owner";
	readonly admin: "admin";
	readonly member: "member";
};
export type GlobalRole = (typeof GlobalRole)[keyof typeof GlobalRole];
export declare const ServiceType: {
	readonly service: "service";
	readonly database: "database";
	readonly queue: "queue";
	readonly cache: "cache";
	readonly gateway: "gateway";
	readonly external: "external";
	readonly infrastructure: "infrastructure";
};
export type ServiceType = (typeof ServiceType)[keyof typeof ServiceType];
export declare const ServiceTier: {
	readonly tier_1: "tier_1";
	readonly tier_2: "tier_2";
	readonly tier_3: "tier_3";
	readonly tier_4: "tier_4";
};
export type ServiceTier = (typeof ServiceTier)[keyof typeof ServiceTier];
export declare const DependencyType: {
	readonly runtime: "runtime";
	readonly build: "build";
	readonly data: "data";
};
export type DependencyType =
	(typeof DependencyType)[keyof typeof DependencyType];
export declare const DependencyCriticality: {
	readonly required: "required";
	readonly optional: "optional";
	readonly degraded: "degraded";
};
export type DependencyCriticality =
	(typeof DependencyCriticality)[keyof typeof DependencyCriticality];
export declare const Severity: {
	readonly critical: "critical";
	readonly high: "high";
	readonly medium: "medium";
	readonly low: "low";
	readonly info: "info";
};
export type Severity = (typeof Severity)[keyof typeof Severity];
export declare const AlertStatus: {
	readonly triggered: "triggered";
	readonly acknowledged: "acknowledged";
	readonly correlated: "correlated";
	readonly resolved: "resolved";
	readonly suppressed: "suppressed";
};
export type AlertStatus = (typeof AlertStatus)[keyof typeof AlertStatus];
export declare const IncidentStatus: {
	readonly triggered: "triggered";
	readonly investigating: "investigating";
	readonly identified: "identified";
	readonly monitoring: "monitoring";
	readonly resolved: "resolved";
	readonly closed: "closed";
};
export type IncidentStatus =
	(typeof IncidentStatus)[keyof typeof IncidentStatus];
export declare const Priority: {
	readonly p1: "p1";
	readonly p2: "p2";
	readonly p3: "p3";
	readonly p4: "p4";
	readonly p5: "p5";
};
export type Priority = (typeof Priority)[keyof typeof Priority];
export declare const WorkflowStatus: {
	readonly pending: "pending";
	readonly running: "running";
	readonly completed: "completed";
	readonly failed: "failed";
	readonly cancelled: "cancelled";
};
export type WorkflowStatus =
	(typeof WorkflowStatus)[keyof typeof WorkflowStatus];
export declare const RootCauseCategory: {
	readonly code: "code";
	readonly config: "config";
	readonly infrastructure: "infrastructure";
	readonly external: "external";
	readonly unknown: "unknown";
};
export type RootCauseCategory =
	(typeof RootCauseCategory)[keyof typeof RootCauseCategory];
export declare const AgentName: {
	readonly alert_agent: "alert_agent";
	readonly gatherer_agent: "gatherer_agent";
	readonly analyzer_agent: "analyzer_agent";
	readonly recommender_agent: "recommender_agent";
	readonly log_retriever_agent: "log_retriever_agent";
};
export type AgentName = (typeof AgentName)[keyof typeof AgentName];
export declare const AgentType: {
	readonly llm: "llm";
	readonly sequential: "sequential";
	readonly loop: "loop";
};
export type AgentType = (typeof AgentType)[keyof typeof AgentType];
export declare const ExecutionStatus: {
	readonly pending: "pending";
	readonly running: "running";
	readonly completed: "completed";
	readonly failed: "failed";
};
export type ExecutionStatus =
	(typeof ExecutionStatus)[keyof typeof ExecutionStatus];
export declare const ToolExecutionStatus: {
	readonly pending: "pending";
	readonly running: "running";
	readonly success: "success";
	readonly error: "error";
};
export type ToolExecutionStatus =
	(typeof ToolExecutionStatus)[keyof typeof ToolExecutionStatus];
export declare const ToolCategory: {
	readonly file: "file";
	readonly search: "search";
	readonly github: "github";
	readonly logs: "logs";
	readonly analysis: "analysis";
};
export type ToolCategory = (typeof ToolCategory)[keyof typeof ToolCategory];
export declare const RecommendationPriority: {
	readonly critical: "critical";
	readonly high: "high";
	readonly medium: "medium";
	readonly low: "low";
};
export type RecommendationPriority =
	(typeof RecommendationPriority)[keyof typeof RecommendationPriority];
export declare const RecommendationCategory: {
	readonly code_fix: "code_fix";
	readonly config_change: "config_change";
	readonly rollback: "rollback";
	readonly monitoring: "monitoring";
	readonly investigation: "investigation";
};
export type RecommendationCategory =
	(typeof RecommendationCategory)[keyof typeof RecommendationCategory];
export declare const Urgency: {
	readonly immediate: "immediate";
	readonly short_term: "short_term";
	readonly long_term: "long_term";
};
export type Urgency = (typeof Urgency)[keyof typeof Urgency];
export declare const EffortEstimate: {
	readonly minutes: "minutes";
	readonly hours: "hours";
	readonly days: "days";
};
export type EffortEstimate =
	(typeof EffortEstimate)[keyof typeof EffortEstimate];
export declare const RecommendationStatus: {
	readonly pending: "pending";
	readonly in_progress: "in_progress";
	readonly completed: "completed";
	readonly rejected: "rejected";
	readonly deferred: "deferred";
};
export type RecommendationStatus =
	(typeof RecommendationStatus)[keyof typeof RecommendationStatus];
export declare const TimelineEntryType: {
	readonly incident_created: "incident_created";
	readonly alert_added: "alert_added";
	readonly alert_removed: "alert_removed";
	readonly status_changed: "status_changed";
	readonly severity_changed: "severity_changed";
	readonly assigned: "assigned";
	readonly investigation_started: "investigation_started";
	readonly investigation_completed: "investigation_completed";
	readonly recommendation_added: "recommendation_added";
	readonly recommendation_completed: "recommendation_completed";
	readonly comment: "comment";
	readonly postmortem_created: "postmortem_created";
	readonly custom: "custom";
};
export type TimelineEntryType =
	(typeof TimelineEntryType)[keyof typeof TimelineEntryType];
export declare const TimelineSource: {
	readonly system: "system";
	readonly user: "user";
	readonly ai_worker: "ai_worker";
};
export type TimelineSource =
	(typeof TimelineSource)[keyof typeof TimelineSource];
export declare const PostmortemStatus: {
	readonly draft: "draft";
	readonly in_review: "in_review";
	readonly published: "published";
	readonly archived: "archived";
};
export type PostmortemStatus =
	(typeof PostmortemStatus)[keyof typeof PostmortemStatus];
export declare const CorrelationAction: {
	readonly correlate: "correlate";
	readonly suppress: "suppress";
	readonly create_incident: "create_incident";
};
export type CorrelationAction =
	(typeof CorrelationAction)[keyof typeof CorrelationAction];
export declare const SettingType: {
	readonly string: "string";
	readonly number: "number";
	readonly boolean: "boolean";
	readonly json: "json";
};
export type SettingType = (typeof SettingType)[keyof typeof SettingType];
export declare const SettingCategory: {
	readonly general: "general";
	readonly correlation: "correlation";
	readonly ai: "ai";
	readonly notifications: "notifications";
};
export type SettingCategory =
	(typeof SettingCategory)[keyof typeof SettingCategory];
export declare const ConnectionStatus: {
	readonly pending: "pending";
	readonly connected: "connected";
	readonly error: "error";
	readonly disabled: "disabled";
};
export type ConnectionStatus =
	(typeof ConnectionStatus)[keyof typeof ConnectionStatus];
export declare const AuthMethod: {
	readonly api_key: "api_key";
	readonly oauth2: "oauth2";
};
export type AuthMethod = (typeof AuthMethod)[keyof typeof AuthMethod];
export declare const SuggestionStatus: {
	readonly pending: "pending";
	readonly accepted: "accepted";
	readonly rejected: "rejected";
	readonly ignored: "ignored";
};
export type SuggestionStatus =
	(typeof SuggestionStatus)[keyof typeof SuggestionStatus];
