export const GlobalRole = {
	owner: "owner",
	admin: "admin",
	member: "member",
};
export const ServiceType = {
	service: "service",
	database: "database",
	queue: "queue",
	cache: "cache",
	gateway: "gateway",
	external: "external",
	infrastructure: "infrastructure",
};
export const ServiceTier = {
	tier_1: "tier_1",
	tier_2: "tier_2",
	tier_3: "tier_3",
	tier_4: "tier_4",
};
export const DependencyType = {
	runtime: "runtime",
	build: "build",
	data: "data",
};
export const DependencyCriticality = {
	required: "required",
	optional: "optional",
	degraded: "degraded",
};
export const Severity = {
	critical: "critical",
	high: "high",
	medium: "medium",
	low: "low",
	info: "info",
};
export const AlertStatus = {
	triggered: "triggered",
	acknowledged: "acknowledged",
	correlated: "correlated",
	resolved: "resolved",
	suppressed: "suppressed",
};
export const IncidentStatus = {
	triggered: "triggered",
	investigating: "investigating",
	identified: "identified",
	monitoring: "monitoring",
	resolved: "resolved",
	closed: "closed",
};
export const Priority = {
	p1: "p1",
	p2: "p2",
	p3: "p3",
	p4: "p4",
	p5: "p5",
};
export const WorkflowStatus = {
	pending: "pending",
	running: "running",
	completed: "completed",
	failed: "failed",
	cancelled: "cancelled",
};
export const RootCauseCategory = {
	code: "code",
	config: "config",
	infrastructure: "infrastructure",
	external: "external",
	unknown: "unknown",
};
export const AgentName = {
	alert_agent: "alert_agent",
	gatherer_agent: "gatherer_agent",
	analyzer_agent: "analyzer_agent",
	recommender_agent: "recommender_agent",
	log_retriever_agent: "log_retriever_agent",
};
export const AgentType = {
	llm: "llm",
	sequential: "sequential",
	loop: "loop",
};
export const ExecutionStatus = {
	pending: "pending",
	running: "running",
	completed: "completed",
	failed: "failed",
};
export const ToolExecutionStatus = {
	pending: "pending",
	running: "running",
	success: "success",
	error: "error",
};
export const ToolCategory = {
	file: "file",
	search: "search",
	github: "github",
	logs: "logs",
	analysis: "analysis",
};
export const RecommendationPriority = {
	critical: "critical",
	high: "high",
	medium: "medium",
	low: "low",
};
export const RecommendationCategory = {
	code_fix: "code_fix",
	config_change: "config_change",
	rollback: "rollback",
	monitoring: "monitoring",
	investigation: "investigation",
};
export const Urgency = {
	immediate: "immediate",
	short_term: "short_term",
	long_term: "long_term",
};
export const EffortEstimate = {
	minutes: "minutes",
	hours: "hours",
	days: "days",
};
export const RecommendationStatus = {
	pending: "pending",
	in_progress: "in_progress",
	completed: "completed",
	rejected: "rejected",
	deferred: "deferred",
};
export const TimelineEntryType = {
	incident_created: "incident_created",
	alert_added: "alert_added",
	alert_removed: "alert_removed",
	status_changed: "status_changed",
	severity_changed: "severity_changed",
	assigned: "assigned",
	investigation_started: "investigation_started",
	investigation_completed: "investigation_completed",
	recommendation_added: "recommendation_added",
	recommendation_completed: "recommendation_completed",
	comment: "comment",
	postmortem_created: "postmortem_created",
	custom: "custom",
};
export const TimelineSource = {
	system: "system",
	user: "user",
	ai_worker: "ai_worker",
};
export const PostmortemStatus = {
	draft: "draft",
	in_review: "in_review",
	published: "published",
	archived: "archived",
};
export const CorrelationAction = {
	correlate: "correlate",
	suppress: "suppress",
	create_incident: "create_incident",
};
export const SettingType = {
	string: "string",
	number: "number",
	boolean: "boolean",
	json: "json",
};
export const SettingCategory = {
	general: "general",
	correlation: "correlation",
	ai: "ai",
	notifications: "notifications",
};
export const ConnectionStatus = {
	pending: "pending",
	connected: "connected",
	error: "error",
	disabled: "disabled",
};
export const AuthMethod = {
	api_key: "api_key",
	oauth2: "oauth2",
};
export const SuggestionStatus = {
	pending: "pending",
	accepted: "accepted",
	rejected: "rejected",
	ignored: "ignored",
};
//# sourceMappingURL=enums.js.map
