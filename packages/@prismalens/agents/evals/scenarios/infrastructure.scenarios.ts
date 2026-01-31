/**
 * Infrastructure Scenarios for Agent Evaluation
 *
 * These scenarios test the agent's ability to identify infrastructure issues:
 * - Node/pod resource exhaustion
 * - Network connectivity problems
 * - Disk space issues
 * - Cloud provider problems
 */

import {
	createInfraScenario,
	createIncident,
	createAlert,
	type ScenarioDefinition,
} from "../fixtures/incidents.js";

// =============================================================================
// MUTUAL EXCLUSIVITY: Forbidden tools for non-clone scenarios
// =============================================================================
// These scenarios do NOT provide clonePaths, so repo tools should NOT be called.
// This ensures mutual exclusivity with clone scenarios.

const FORBIDDEN_REPO_TOOLS = [
	"repo_read_file",
	"repo_list_directory",
	"repo_search_text",
	"repo_get_file_info",
];

// =============================================================================
// EASY SCENARIOS (Clear infrastructure failures)
// =============================================================================

/**
 * Node out of memory causing pod evictions.
 * Clear OOM and eviction signals.
 */
export const nodeOOM: ScenarioDefinition = createInfraScenario(
	"node-out-of-memory",
	{
		difficulty: "easy",
		input: {
			investigationId: "eval-nodeoom-001",
			incidentId: "inc-nodeoom-001",
			priority: "critical",
			incident: createIncident({
				incidentId: "inc-nodeoom-001",
				title: "Multiple pods evicted due to node memory pressure",
				description:
					"Kubernetes node worker-3 is experiencing memory pressure. " +
					"Multiple pods have been evicted. Node memory at 98% utilization. " +
					"Kubelet is evicting pods to prevent node crash.",
				severity: "critical",
				serviceName: "multiple",
				alertCount: 4,
			}),
			alerts: [
				createAlert({
					alertId: "alert-nodeoom-001",
					name: "NodeMemoryPressure",
					message: "Node worker-3 under memory pressure",
					severity: "critical",
					annotations: {
						node: "worker-3",
						memory_usage: "98%",
						allocatable: "32Gi",
						used: "31.4Gi",
					},
				}),
				createAlert({
					alertId: "alert-nodeoom-002",
					name: "PodEvicted",
					message: "Pod evicted due to node memory pressure",
					severity: "high",
					annotations: {
						reason: "Evicted",
						message: "The node was low on resource: memory",
						evicted_pods: "api-server-x2k4m, worker-service-9b7d3",
						node: "worker-3",
					},
				}),
				createAlert({
					alertId: "alert-nodeoom-003",
					name: "KubeletPressure",
					message: "Kubelet reporting memory.available below threshold",
					severity: "critical",
					annotations: {
						condition: "MemoryPressure",
						status: "True",
						available_memory: "512Mi",
						eviction_threshold: "1Gi",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 60,
			rootCauseCategory: "infrastructure",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["node", "memory", "eviction", "pressure"],
			forbiddenToolCalls: FORBIDDEN_REPO_TOOLS,
		},
	},
);

/**
 * Disk full on persistent volume.
 * Clear disk space errors.
 */
export const diskFull: ScenarioDefinition = createInfraScenario(
	"disk-space-exhausted",
	{
		difficulty: "easy",
		input: {
			investigationId: "eval-disk-001",
			incidentId: "inc-disk-001",
			priority: "critical",
			incident: createIncident({
				incidentId: "inc-disk-001",
				title: "Database write failures due to disk full",
				description:
					"PostgreSQL database rejecting writes with 'no space left on device'. " +
					"Primary volume at 100% capacity. Log growth and temp table creation " +
					"consuming remaining space faster than expected.",
				severity: "critical",
				serviceName: "postgres-primary",
				alertCount: 3,
			}),
			alerts: [
				createAlert({
					alertId: "alert-disk-001",
					name: "DiskSpaceCritical",
					message: "Persistent volume at 100% capacity",
					severity: "critical",
					annotations: {
						volume: "pvc-postgres-data",
						capacity: "100Gi",
						used: "99.8Gi",
						available: "0.2Gi",
					},
				}),
				createAlert({
					alertId: "alert-disk-002",
					name: "PostgresWriteFailed",
					message: "PostgreSQL cannot write to disk",
					severity: "critical",
					annotations: {
						error: "PANIC: could not write to file 'pg_wal/...': No space left on device",
						database: "primary",
						impact: "All writes blocked",
					},
				}),
				createAlert({
					alertId: "alert-disk-003",
					name: "WALAccumulation",
					message: "WAL files accumulating faster than archival",
					severity: "high",
					annotations: {
						wal_size: "45Gi",
						archive_lag: "127 files",
						oldest_wal_age: "6 hours",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 65,
			rootCauseCategory: "infrastructure",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["disk", "space", "volume", "full", "WAL"],
			forbiddenToolCalls: FORBIDDEN_REPO_TOOLS,
		},
	},
);

// =============================================================================
// MEDIUM SCENARIOS (Requires infrastructure correlation)
// =============================================================================

/**
 * Network partition causing intermittent connectivity.
 * Agent needs to correlate network errors across services.
 */
export const networkPartition: ScenarioDefinition = createInfraScenario(
	"network-partition",
	{
		difficulty: "medium",
		input: {
			investigationId: "eval-network-001",
			incidentId: "inc-network-001",
			priority: "critical",
			incident: createIncident({
				incidentId: "inc-network-001",
				title: "Intermittent service communication failures",
				description:
					"Services in us-west-2a cannot reliably communicate with services in us-west-2b. " +
					"Connection timeouts and resets happening sporadically. " +
					"Suspect network issue between availability zones.",
				severity: "critical",
				serviceName: "multiple",
				alertCount: 4,
			}),
			alerts: [
				createAlert({
					alertId: "alert-network-001",
					name: "ConnectionTimeout",
					message: "Cross-AZ connections timing out",
					severity: "critical",
					annotations: {
						source_az: "us-west-2a",
						target_az: "us-west-2b",
						timeout_rate: "35%",
						affected_services: "api-server, database-replica",
					},
				}),
				createAlert({
					alertId: "alert-network-002",
					name: "PacketLoss",
					message: "Elevated packet loss between AZs",
					severity: "high",
					annotations: {
						packet_loss: "12%",
						latency_p50: "45ms (normal: 2ms)",
						retransmits: "1247/min",
					},
				}),
				createAlert({
					alertId: "alert-network-003",
					name: "ConnectionReset",
					message: "TCP connection resets elevated",
					severity: "high",
					annotations: {
						reset_count: "3421",
						affected_traffic: "us-west-2a <-> us-west-2b",
						protocol: "TCP",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 45,
			rootCauseCategory: "infrastructure",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["network", "AZ", "partition", "connectivity", "packet"],
			forbiddenToolCalls: FORBIDDEN_REPO_TOOLS,
		},
	},
);

/**
 * Load balancer health check misconfiguration.
 * Healthy instances being marked unhealthy.
 */
export const loadBalancerIssue: ScenarioDefinition = createInfraScenario(
	"load-balancer-health-check",
	{
		difficulty: "medium",
		input: {
			investigationId: "eval-lb-001",
			incidentId: "inc-lb-001",
			priority: "high",
			incident: createIncident({
				incidentId: "inc-lb-001",
				title: "Intermittent 502 errors despite healthy backend pods",
				description:
					"Users seeing 502 Bad Gateway errors sporadically. " +
					"All pods appear healthy in Kubernetes but ALB shows targets as unhealthy. " +
					"Health check path returns 200 when tested directly. " +
					"Suspect health check configuration mismatch.",
				severity: "high",
				serviceName: "api-server",
				alertCount: 3,
			}),
			alerts: [
				createAlert({
					alertId: "alert-lb-001",
					name: "HighError502",
					message: "502 error rate exceeding threshold",
					severity: "high",
					annotations: {
						error_rate: "8%",
						load_balancer: "prod-api-alb",
						healthy_targets: "2/5",
					},
				}),
				createAlert({
					alertId: "alert-lb-002",
					name: "TargetUnhealthy",
					message: "ALB target health check failing",
					severity: "high",
					annotations: {
						target_group: "tg-api-server",
						unhealthy_count: "3",
						health_check_path: "/health",
						health_check_timeout: "5s",
						failure_reason: "Request timeout",
					},
				}),
				createAlert({
					alertId: "alert-lb-003",
					name: "PodHealthy",
					message: "Kubernetes readiness probe passing",
					severity: "info",
					annotations: {
						pods_ready: "5/5",
						readiness_path: "/ready",
						all_pods: "Running",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 45,
			rootCauseCategory: "infrastructure",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["load balancer", "health check", "ALB", "target", "502"],
			forbiddenToolCalls: FORBIDDEN_REPO_TOOLS,
		},
	},
);

// =============================================================================
// HARD SCENARIOS (Complex multi-factor infrastructure issues)
// =============================================================================

/**
 * Cloud provider throttling causing cascade.
 * API rate limits hit causing downstream effects.
 */
export const cloudThrottling: ScenarioDefinition = createInfraScenario(
	"cloud-api-throttling",
	{
		difficulty: "hard",
		input: {
			investigationId: "eval-throttle-001",
			incidentId: "inc-throttle-001",
			priority: "high",
			incident: createIncident({
				incidentId: "inc-throttle-001",
				title: "S3 operations failing with ThrottlingException",
				description:
					"File uploads and downloads failing intermittently. " +
					"AWS S3 returning ThrottlingException. Our batch job is making " +
					"10,000 requests/minute to a single bucket prefix, exceeding limits. " +
					"This is affecting the main application's file operations.",
				severity: "high",
				serviceName: "file-service",
				alertCount: 3,
			}),
			alerts: [
				createAlert({
					alertId: "alert-throttle-001",
					name: "S3Throttling",
					message: "S3 API returning ThrottlingException",
					severity: "high",
					annotations: {
						exception: "ThrottlingException",
						bucket: "prod-uploads",
						prefix: "user-files/2024/01/",
						request_rate: "10,247/min",
						throttled_rate: "2,341/min",
					},
				}),
				createAlert({
					alertId: "alert-throttle-002",
					name: "FileUploadFailed",
					message: "User file upload failures elevated",
					severity: "high",
					annotations: {
						failure_rate: "23%",
						affected_operation: "PutObject",
						user_impact: "Unable to upload profile pictures",
					},
				}),
				createAlert({
					alertId: "alert-throttle-003",
					name: "BatchJobTimeout",
					message: "Data export batch job timing out",
					severity: "medium",
					annotations: {
						job: "daily-data-export",
						status: "failed",
						reason: "Excessive S3 throttling",
						attempt: "3/3",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 35,
			rootCauseCategory: "infrastructure",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["throttling", "S3", "rate limit", "AWS", "prefix"],
			forbiddenToolCalls: FORBIDDEN_REPO_TOOLS,
		},
	},
);

/**
 * DNS resolution issues causing sporadic failures.
 * TTL and caching causing stale records.
 */
export const dnsIssue: ScenarioDefinition = createInfraScenario(
	"dns-resolution-failure",
	{
		difficulty: "hard",
		input: {
			investigationId: "eval-dns-001",
			incidentId: "inc-dns-001",
			priority: "high",
			incident: createIncident({
				incidentId: "inc-dns-001",
				title: "Intermittent external API connection failures",
				description:
					"Connections to third-party payment API failing with 'getaddrinfo ENOTFOUND'. " +
					"Failures are sporadic and affect only some pods. " +
					"DNS TTL is 60s but CoreDNS cache is set to 300s. " +
					"Recent IP change by payment provider not propagating consistently.",
				severity: "high",
				serviceName: "payment-service",
				alertCount: 3,
			}),
			alerts: [
				createAlert({
					alertId: "alert-dns-001",
					name: "DNSResolutionFailed",
					message: "DNS lookup failure for external service",
					severity: "high",
					annotations: {
						error: "getaddrinfo ENOTFOUND api.paymentprovider.com",
						affected_pods: "payment-service-7d8f9, payment-service-9c4e2",
						working_pods: "payment-service-3a7b1",
					},
				}),
				createAlert({
					alertId: "alert-dns-002",
					name: "ConnectionFailed",
					message: "Payment API connection failures",
					severity: "high",
					annotations: {
						failure_pattern: "sporadic, pod-specific",
						retry_success_rate: "varies by pod",
						external_host: "api.paymentprovider.com",
					},
				}),
				createAlert({
					alertId: "alert-dns-003",
					name: "CoreDNSCacheMismatch",
					message: "DNS cache returning stale records",
					severity: "medium",
					annotations: {
						cached_ip: "203.0.113.10",
						current_ip: "203.0.113.25",
						cache_ttl: "300s",
						record_ttl: "60s",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 30,
			rootCauseCategory: "infrastructure",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["DNS", "cache", "TTL", "resolution", "CoreDNS"],
			forbiddenToolCalls: FORBIDDEN_REPO_TOOLS,
		},
	},
);

/**
 * Complex scenario: gradual degradation from multiple factors.
 * Memory pressure + network latency + disk I/O.
 */
export const multiFactorDegradation: ScenarioDefinition = createInfraScenario(
	"multi-factor-degradation",
	{
		difficulty: "hard",
		input: {
			investigationId: "eval-multi-001",
			incidentId: "inc-multi-001",
			priority: "critical",
			incident: createIncident({
				incidentId: "inc-multi-001",
				title: "Service degradation with multiple contributing factors",
				description:
					"api-server experiencing severe performance degradation. " +
					"Multiple symptoms: high memory usage, elevated latency, disk I/O contention. " +
					"No single clear cause. Situation worsening over past 2 hours. " +
					"Possible cascade effect from initial memory pressure.",
				severity: "critical",
				serviceName: "api-server",
				alertCount: 5,
			}),
			alerts: [
				createAlert({
					alertId: "alert-multi-001",
					name: "HighLatency",
					message: "API latency exceeding SLA",
					severity: "critical",
					annotations: {
						p95_latency: "4.2s",
						p99_latency: "12s",
						sla_target: "500ms",
					},
				}),
				createAlert({
					alertId: "alert-multi-002",
					name: "MemoryHigh",
					message: "Container memory at 92%",
					severity: "high",
					annotations: {
						memory_usage: "92%",
						trend: "increasing 2%/hour",
						gc_frequency: "elevated",
					},
				}),
				createAlert({
					alertId: "alert-multi-003",
					name: "DiskIOHigh",
					message: "Disk I/O latency elevated",
					severity: "medium",
					annotations: {
						read_latency: "45ms (normal: 5ms)",
						write_latency: "120ms (normal: 10ms)",
						iops: "12,000 (limit: 16,000)",
					},
				}),
				createAlert({
					alertId: "alert-multi-004",
					name: "SwapUsage",
					message: "Container swapping to disk",
					severity: "high",
					annotations: {
						swap_usage: "1.2Gi",
						swap_in_rate: "50MB/s",
						memory_pressure: "true",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 25,
			rootCauseCategory: "infrastructure",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["memory", "disk", "latency", "swap", "cascade"],
			forbiddenToolCalls: FORBIDDEN_REPO_TOOLS,
		},
	},
);

// =============================================================================
// EXPORT ALL SCENARIOS
// =============================================================================

export const infrastructureScenarios: ScenarioDefinition[] = [
	nodeOOM,
	diskFull,
	networkPartition,
	loadBalancerIssue,
	cloudThrottling,
	dnsIssue,
	multiFactorDegradation,
];

export const easyInfraScenarios = infrastructureScenarios.filter(
	(s) => s.difficulty === "easy",
);

export const mediumInfraScenarios = infrastructureScenarios.filter(
	(s) => s.difficulty === "medium",
);

export const hardInfraScenarios = infrastructureScenarios.filter(
	(s) => s.difficulty === "hard",
);
