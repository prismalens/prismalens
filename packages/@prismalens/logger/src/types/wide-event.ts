/**
 * Wide Event structure following loggingsucks.com principles.
 * One comprehensive event per request per service with high dimensionality.
 *
 * @see https://loggingsucks.com/
 */
export interface WideEvent {
	// === Identity & Tracing (Required) ===
	/** Unique ID for this request within service */
	request_id: string;
	/** Distributed trace ID (propagated across services) */
	trace_id?: string;
	/** Span ID for this operation */
	span_id?: string;
	/** Parent span for nested operations */
	parent_span_id?: string;

	// === Timestamp ===
	/** ISO 8601 timestamp */
	timestamp: string;
	/** Request duration in milliseconds (set at end) */
	duration_ms?: number;

	// === Service Metadata ===
	service: ServiceInfo;

	// === Request Context ===
	request?: RequestInfo;

	// === Response Context ===
	response?: ResponseInfo;

	// === User/Session Context ===
	user?: UserInfo;

	// === Business Context (extensible) ===
	context?: BusinessContext;

	// === Error Details ===
	error?: ErrorDetail;

	// === Performance Metrics ===
	metrics?: PerformanceMetrics;

	// === Sampling Decision ===
	sampling?: SamplingInfo;

	// === Log Entry (for traditional log lines) ===
	log?: LogInfo;

	// === Feature Flags (for tail sampling decisions) ===
	feature_flags?: Record<string, boolean | string>;

	// === Tags for filtering/alerting ===
	tags?: string[];
}

export interface ServiceInfo {
	/** Service name (e.g., "prismalens-api", "prismalens-worker") */
	name: string;
	/** Semver from package.json */
	version: string;
	/** Environment: "development", "staging", "production" */
	environment: string;
	/** Container/pod ID for horizontal scaling */
	instance_id?: string;
}

export interface RequestInfo {
	/** HTTP method */
	method?: string;
	/** URL path */
	path?: string;
	/** Route pattern (e.g., /api/alerts/:id) */
	route?: string;
	/** Query parameters */
	query?: Record<string, unknown>;
	/** Request headers (sensitive ones redacted) */
	headers?: Record<string, string>;
	/** Request body size in bytes */
	body_size?: number;
	/** User agent string */
	user_agent?: string;
	/** Client IP (may be hashed/anonymized) */
	ip?: string;
}

export interface ResponseInfo {
	/** HTTP status code */
	status_code?: number;
	/** Response body size in bytes */
	body_size?: number;
	/** Response headers */
	headers?: Record<string, string>;
}

export interface UserInfo {
	/** User ID */
	id?: string;
	/** Email (may be redacted) */
	email?: string;
	/** User role */
	role?: string;
	/** Session ID */
	session_id?: string;
}

export interface BusinessContext {
	/** Incident ID being processed */
	incident_id?: string;
	/** Investigation ID */
	investigation_id?: string;
	/** Alert ID */
	alert_id?: string;
	/** Service ID */
	service_id?: string;
	/** Job ID (for background jobs) */
	job_id?: string;
	/** Job name (for background jobs) */
	job_name?: string;
	/** Extensible business data */
	[key: string]: unknown;
}

export interface ErrorDetail {
	/** Error class/name */
	type: string;
	/** Error message */
	message: string;
	/** Stack trace */
	stack?: string;
	/** Application error code */
	code?: string;
	/** Nested cause */
	cause?: ErrorDetail;
}

export interface PerformanceMetrics {
	/** Number of database queries executed */
	db_query_count?: number;
	/** Total database query time in ms */
	db_query_time_ms?: number;
	/** Cache hits */
	cache_hits?: number;
	/** Cache misses */
	cache_misses?: number;
	/** External service calls */
	external_calls?: ExternalCallMetric[];
	/** Memory usage in MB */
	memory_used_mb?: number;
	/** CPU time in ms */
	cpu_time_ms?: number;
}

export interface ExternalCallMetric {
	/** External service name */
	service: string;
	/** Method/endpoint called */
	method: string;
	/** Call duration in ms */
	duration_ms: number;
	/** Response status */
	status?: number;
	/** Error message if failed */
	error?: string;
}

export interface SamplingInfo {
	/** Sampling decision result */
	decision: "sampled" | "retained" | "dropped";
	/** Reason for the decision */
	reason?: SamplingReason;
	/** Sample rate that was applied */
	rate?: number;
}

export interface LogInfo {
	/** Log level */
	level: LogLevel;
	/** Log message */
	message: string;
	/** Logger context/class name */
	context?: string;
	/** Additional log arguments */
	args?: unknown[];
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export type SamplingReason =
	| "error" // 5xx or exception
	| "slow_request" // Exceeded latency threshold
	| "vip_traffic" // Flagged session
	| "feature_test" // Feature flag enabled
	| "random_sample" // Normal traffic sample
	| "force_retain"; // Explicitly marked for retention
