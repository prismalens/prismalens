/**
 * Configuration Issue Scenarios for Agent Evaluation
 *
 * These scenarios test the agent's ability to identify config-related issues:
 * - Database connection problems
 * - Environment variable misconfigurations
 * - Resource limit issues
 * - Feature flag problems
 *
 * Each scenario includes mock responses for GitHub and Render to enable
 * controlled, repeatable testing without real API calls.
 */

import {
	createConfigScenario,
	createIncident,
	createAlert,
	type ScenarioDefinition,
} from "../fixtures/incidents.js";
import type { ScenarioWithMocks } from "./types.js";

// =============================================================================
// EASY SCENARIOS (Clear config errors)
// =============================================================================

/**
 * Database connection pool exhausted.
 * Clear error messages about connection limits.
 */
export const connectionPoolExhausted: ScenarioWithMocks = {
	...createConfigScenario("connection-pool-exhausted", {
		difficulty: "easy",
		input: {
			investigationId: "eval-pool-001",
			incidentId: "inc-pool-001",
			priority: "critical",
			incident: createIncident({
				incidentId: "inc-pool-001",
				title: "Database connection failures across all services",
				description:
					"All services are failing to connect to the primary PostgreSQL database. " +
					"Errors show 'too many connections' and connection pool exhaustion. " +
					"Currently at 100/100 max connections. Each service uses pool_size=20.",
				severity: "critical",
				serviceName: "api-server",
				alertCount: 5,
			}),
			alerts: [
				createAlert({
					alertId: "alert-pool-001",
					name: "DatabaseConnectionFailed",
					message: "FATAL: too many connections for role 'app_user'",
					severity: "critical",
					annotations: {
						database: "primary-postgres",
						current_connections: "100",
						max_connections: "100",
						error: "FATAL: too many connections for role 'app_user'",
					},
				}),
				createAlert({
					alertId: "alert-pool-002",
					name: "ConnectionPoolExhausted",
					message: "Connection pool exhausted, requests queuing",
					severity: "critical",
					annotations: {
						pool_size: "20",
						active: "20",
						waiting: "147",
						timeout_ms: "30000",
					},
				}),
				createAlert({
					alertId: "alert-pool-003",
					name: "ServiceDown",
					message: "api-server health check failing",
					severity: "critical",
					annotations: {
						health_endpoint: "/health",
						response: "503 Service Unavailable",
						reason: "Database connection check failed",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 60,
			rootCauseCategory: "config",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["connection", "pool", "max_connections", "database"],
		},
	}),
	mocks: {
		github: {
			searchCode: [
				{ file: "config/database.yaml", line: 12, snippet: "pool_size: 20" },
				{ file: "config/database.yaml", line: 3, snippet: "max_connections: 100" },
				{ file: "src/config/db.ts", line: 8, snippet: "poolSize: parseInt(process.env.DB_POOL_SIZE || '20')," },
			],
			getFile: {
				"config/database.yaml": `# PostgreSQL Configuration
database:
  host: primary-postgres.internal
  port: 5432
  max_connections: 100  # Server-side limit

  # Per-service pool settings
  pool:
    pool_size: 20       # Each service gets 20 connections
    max_overflow: 5     # Allow 5 extra during spikes
    pool_timeout: 30    # Wait 30s for available connection

# WARNING: 5 services x 20 connections = 100 connections
# No room for overflow or admin connections!`,
				"docker-compose.yaml": `services:
  api-server:
    environment:
      - DB_POOL_SIZE=20
  worker-service:
    environment:
      - DB_POOL_SIZE=20
  auth-service:
    environment:
      - DB_POOL_SIZE=20
  notification-service:
    environment:
      - DB_POOL_SIZE=20
  analytics-service:
    environment:
      - DB_POOL_SIZE=20`,
			},
			listCommits: [
				{
					sha: "pool123",
					message: "feat: add analytics-service (5th service using DB pool)",
					author: "infra@example.com",
					date: "2024-01-14T09:00:00Z",
				},
				{
					sha: "pool456",
					message: "config: set default pool_size to 20 for better throughput",
					author: "dba@example.com",
					date: "2024-01-10T14:00:00Z",
				},
			],
		},
		render: {
			getLogs: [
				{
					timestamp: "2024-01-15T11:30:00Z",
					level: "error",
					message: "FATAL: too many connections for role 'app_user' (max: 100)",
				},
				{
					timestamp: "2024-01-15T11:29:55Z",
					level: "error",
					message: "Connection pool exhausted. 147 requests waiting. Timeout in 30s.",
				},
				{
					timestamp: "2024-01-15T11:29:50Z",
					level: "warn",
					message: "Connection pool at 95% capacity: 19/20 connections in use",
				},
			],
			listServices: [
				{ id: "srv-api", name: "api-server", status: "running", lastDeployStatus: "succeeded" },
				{ id: "srv-worker", name: "worker-service", status: "running", lastDeployStatus: "succeeded" },
				{ id: "srv-auth", name: "auth-service", status: "running", lastDeployStatus: "succeeded" },
				{ id: "srv-notif", name: "notification-service", status: "running", lastDeployStatus: "succeeded" },
				{
					id: "srv-analytics",
					name: "analytics-service",
					status: "running",
					lastDeployedAt: "2024-01-14T10:00:00Z",
					lastDeployStatus: "succeeded",
				},
			],
		},
	},
	solutionHint:
		"Calculate: 5 services x 20 connections = 100 = max_connections. " +
		"Recent addition of analytics-service pushed total to exactly 100. " +
		"Recommend increasing max_connections or reducing pool_size per service.",
	tags: ["easy", "database", "connection-pool", "config"],
};

/**
 * Missing environment variable.
 * Service fails because required env var is not set.
 */
export const missingEnvVar: ScenarioWithMocks = {
	...createConfigScenario("missing-environment-variable", {
		difficulty: "easy",
		input: {
			investigationId: "eval-env-001",
			incidentId: "inc-env-001",
			priority: "high",
			incident: createIncident({
				incidentId: "inc-env-001",
				title: "Authentication service failing to start",
				description:
					"auth-service pods are crashlooping after latest deployment. " +
					"Logs show 'JWT_SECRET environment variable is required'. " +
					"The secret was migrated to new vault path but deployment manifest not updated.",
				severity: "high",
				serviceName: "auth-service",
				alertCount: 2,
			}),
			alerts: [
				createAlert({
					alertId: "alert-env-001",
					name: "PodCrashLoop",
					message: "auth-service pod in CrashLoopBackOff",
					severity: "high",
					annotations: {
						pod: "auth-service-7d8f9b6c5-x2k4m",
						restart_count: "5",
						last_exit_code: "1",
						reason: "Error",
					},
				}),
				createAlert({
					alertId: "alert-env-002",
					name: "StartupFailure",
					message: "Application failed to start: missing required config",
					severity: "high",
					annotations: {
						error: "Error: JWT_SECRET environment variable is required",
						startup_phase: "config_validation",
						deployment: "auth-service-v2.4.0",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 70,
			rootCauseCategory: "config",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["JWT_SECRET", "environment", "variable", "missing"],
		},
	}),
	mocks: {
		github: {
			searchCode: [
				{ file: "src/config/auth.ts", line: 5, snippet: "const JWT_SECRET = requireEnv('JWT_SECRET');" },
				{ file: "deploy/auth-service.yaml", line: 22, snippet: "- name: JWT_SECRET" },
				{ file: "deploy/auth-service.yaml", line: 23, snippet: "valueFrom: secretKeyRef: key: jwt-secret" },
			],
			getFile: {
				"src/config/auth.ts": `import { requireEnv } from './utils';

// Required environment variables for auth service
const JWT_SECRET = requireEnv('JWT_SECRET');  // FATAL if not set
const JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(\`\${name} environment variable is required\`);
  }
  return value;
}

export { JWT_SECRET, JWT_EXPIRY };`,
				"deploy/auth-service.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth-service
spec:
  template:
    spec:
      containers:
      - name: auth-service
        env:
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: auth-secrets  # OLD: was 'jwt-secrets'
              key: jwt-secret     # Secret was moved to new vault path
        - name: JWT_EXPIRY
          value: "1h"`,
			},
			listCommits: [
				{
					sha: "env123",
					message: "security: migrate secrets to new vault path (breaking change)",
					author: "security@example.com",
					date: "2024-01-14T16:00:00Z",
				},
				{
					sha: "env456",
					message: "chore: update deployment manifests for new secrets structure",
					author: "devops@example.com",
					date: "2024-01-14T15:30:00Z",
				},
			],
		},
		render: {
			getLogs: [
				{
					timestamp: "2024-01-15T08:00:10Z",
					level: "error",
					message: "Error: JWT_SECRET environment variable is required",
				},
				{
					timestamp: "2024-01-15T08:00:09Z",
					level: "info",
					message: "Loading configuration from environment...",
				},
				{
					timestamp: "2024-01-15T08:00:08Z",
					level: "info",
					message: "Starting auth-service v2.4.0...",
				},
			],
			listServices: [
				{
					id: "srv-auth",
					name: "auth-service",
					status: "failed",
					lastDeployedAt: "2024-01-15T08:00:00Z",
					lastDeployStatus: "failed",
				},
			],
		},
	},
	solutionHint:
		"The secret was migrated to a new vault path but the deployment manifest still references " +
		"the old secret name. Update secretKeyRef to point to new secret.",
	tags: ["easy", "env-var", "secret", "config", "kubernetes"],
};

// =============================================================================
// MEDIUM SCENARIOS (Requires correlation)
// =============================================================================

/**
 * Incorrect timeout configuration causing cascading failures.
 * Agent needs to correlate timeout values with error patterns.
 */
export const timeoutMisconfiguration: ScenarioWithMocks = {
	...createConfigScenario("timeout-misconfiguration", {
		difficulty: "medium",
		input: {
			investigationId: "eval-timeout-001",
			incidentId: "inc-timeout-001",
			priority: "high",
			incident: createIncident({
				incidentId: "inc-timeout-001",
				title: "Cascade of timeout errors during peak load",
				description:
					"During peak traffic, services are timing out in a cascade. " +
					"API gateway timeout (30s) > Service A timeout (60s) > Database timeout (120s). " +
					"The timeout hierarchy is inverted causing retries to compound the problem.",
				severity: "high",
				serviceName: "api-gateway",
				alertCount: 4,
			}),
			alerts: [
				createAlert({
					alertId: "alert-timeout-001",
					name: "GatewayTimeout",
					message: "API Gateway 504 errors exceeding threshold",
					severity: "high",
					annotations: {
						gateway_timeout: "30s",
						error_count: "2341",
						error_rate: "12%",
						affected_endpoints: "/api/orders, /api/inventory",
					},
				}),
				createAlert({
					alertId: "alert-timeout-002",
					name: "UpstreamTimeout",
					message: "service-a upstream timeout",
					severity: "high",
					annotations: {
						service_timeout: "60s",
						calling_service: "api-gateway",
						configured_timeout: "60000ms",
					},
				}),
				createAlert({
					alertId: "alert-timeout-003",
					name: "RetryStorm",
					message: "Excessive retry attempts detected",
					severity: "medium",
					annotations: {
						retry_rate: "300/s",
						normal_rate: "20/s",
						retry_config: "3 retries with exponential backoff",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 45,
			rootCauseCategory: "config",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["timeout", "cascade", "retry", "hierarchy"],
		},
	}),
	mocks: {
		github: {
			searchCode: [
				{ file: "config/gateway.yaml", line: 8, snippet: "timeout: 30s" },
				{ file: "config/service-a.yaml", line: 12, snippet: "timeout: 60s" },
				{ file: "config/database.yaml", line: 15, snippet: "statement_timeout: 120s" },
			],
			getFile: {
				"config/gateway.yaml": `# API Gateway Configuration
gateway:
  listen_port: 8080

  # Timeout settings - INVERTED HIERARCHY!
  timeouts:
    read: 30s      # Gateway gives up after 30s
    write: 30s
    idle: 120s

  # Upstream (service-a) has LONGER timeout (60s)
  # This means gateway times out BEFORE service-a completes
  upstream:
    service_a:
      timeout: 60s  # BUG: Should be < 30s

  retry:
    max_attempts: 3
    backoff: exponential`,
				"config/service-a.yaml": `# Service A Configuration
service:
  name: service-a

  # Timeout for downstream calls (database)
  timeouts:
    request: 60s     # Service A waits up to 60s
    connection: 5s

  # Database has EVEN LONGER timeout (120s)
  # Cascade: Gateway (30s) < Service A (60s) < DB (120s) - INVERTED!
  database:
    statement_timeout: 120s  # BUG: Should be < 60s`,
			},
			listCommits: [
				{
					sha: "timeout123",
					message: "config: increase gateway timeout to handle slow requests",
					author: "ops@example.com",
					date: "2024-01-12T14:00:00Z",
				},
				{
					sha: "timeout456",
					message: "fix: increase DB statement_timeout to prevent query kills",
					author: "dba@example.com",
					date: "2024-01-10T11:00:00Z",
				},
			],
		},
		render: {
			getLogs: [
				{
					timestamp: "2024-01-15T14:00:30Z",
					level: "error",
					message: "504 Gateway Timeout: upstream service-a did not respond within 30s",
				},
				{
					timestamp: "2024-01-15T14:00:29Z",
					level: "warn",
					message: "Request retry attempt 2/3 for /api/orders after timeout",
				},
				{
					timestamp: "2024-01-15T14:00:00Z",
					level: "warn",
					message: "Request retry attempt 1/3 for /api/orders after timeout",
				},
			],
		},
	},
	solutionHint:
		"Identify inverted timeout hierarchy: Gateway (30s) times out before Service A (60s) " +
		"which times out before DB (120s). Recommend: DB < Service < Gateway timeouts.",
	tags: ["medium", "timeout", "cascade", "config"],
};

/**
 * Resource limits too low for workload.
 * Memory/CPU limits causing throttling and OOM.
 */
export const resourceLimits: ScenarioWithMocks = {
	...createConfigScenario("resource-limits-too-low", {
		difficulty: "medium",
		input: {
			investigationId: "eval-resource-001",
			incidentId: "inc-resource-001",
			priority: "high",
			incident: createIncident({
				incidentId: "inc-resource-001",
				title: "Service performance degradation and OOM kills",
				description:
					"worker-service experiencing slow processing and occasional OOM kills. " +
					"Memory limit is 512Mi but profiling shows 600-800Mi is needed for normal operation. " +
					"CPU is also throttled frequently, causing job timeouts.",
				severity: "high",
				serviceName: "worker-service",
				alertCount: 3,
			}),
			alerts: [
				createAlert({
					alertId: "alert-resource-001",
					name: "OOMKilled",
					message: "Container killed due to memory limit",
					severity: "high",
					annotations: {
						container: "worker-service",
						memory_limit: "512Mi",
						memory_at_kill: "512Mi",
						exit_code: "137",
					},
				}),
				createAlert({
					alertId: "alert-resource-002",
					name: "CPUThrottling",
					message: "Container CPU throttled > 50% of time",
					severity: "medium",
					annotations: {
						cpu_limit: "500m",
						throttle_percent: "67%",
						throttle_periods: "1204",
					},
				}),
				createAlert({
					alertId: "alert-resource-003",
					name: "JobTimeout",
					message: "Background jobs timing out",
					severity: "medium",
					annotations: {
						timeout_count: "34",
						job_types: "image_processing, report_generation",
						average_completion: "45s (normal: 15s)",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 50,
			rootCauseCategory: "config",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["memory", "limit", "CPU", "throttle", "resource"],
		},
	}),
	mocks: {
		github: {
			searchCode: [
				{ file: "deploy/worker-service.yaml", line: 25, snippet: "memory: 512Mi" },
				{ file: "deploy/worker-service.yaml", line: 26, snippet: "cpu: 500m" },
				{ file: "docs/capacity-planning.md", line: 45, snippet: "worker-service: 800Mi memory, 1 CPU" },
			],
			getFile: {
				"deploy/worker-service.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker-service
spec:
  template:
    spec:
      containers:
      - name: worker-service
        resources:
          requests:
            memory: 256Mi
            cpu: 250m
          limits:
            memory: 512Mi   # BUG: Too low! Profiling shows 600-800Mi needed
            cpu: 500m       # BUG: Too low! Causes 67% throttling`,
				"docs/capacity-planning.md": `# Capacity Planning Guide

## Worker Service

Based on production profiling (2024-01):
- Memory: 800Mi recommended (peak: 750Mi during image processing)
- CPU: 1 core recommended (peak: 0.9 during report generation)

Current limits (OUTDATED):
- Memory: 512Mi
- CPU: 500m

NOTE: These limits were set before image processing feature was added.`,
			},
			listCommits: [
				{
					sha: "resource123",
					message: "feat: add image processing to worker service",
					author: "feature-dev@example.com",
					date: "2024-01-08T10:00:00Z",
				},
				{
					sha: "resource456",
					message: "docs: add capacity planning guide for worker service",
					author: "sre@example.com",
					date: "2024-01-12T15:00:00Z",
				},
			],
		},
		render: {
			getLogs: [
				{
					timestamp: "2024-01-15T13:30:00Z",
					level: "error",
					message: "Container killed: OOM (exit code 137). Memory limit: 512Mi, usage at kill: 512Mi",
				},
				{
					timestamp: "2024-01-15T13:25:00Z",
					level: "warn",
					message: "CPU throttling detected: 67% of periods throttled (1204 total)",
				},
				{
					timestamp: "2024-01-15T13:20:00Z",
					level: "warn",
					message: "Job 'image_processing_batch_42' timed out after 45s (expected: 15s)",
				},
			],
		},
	},
	solutionHint:
		"Resource limits are outdated after adding image processing feature. " +
		"Capacity planning doc shows 800Mi/1CPU needed but limits are 512Mi/500m. " +
		"Recommend updating resource limits to match capacity planning guide.",
	tags: ["medium", "resources", "oom", "throttling", "kubernetes"],
};

// =============================================================================
// HARD SCENARIOS (Complex config issues)
// =============================================================================

/**
 * Feature flag causing unexpected behavior in specific conditions.
 * Agent needs to trace the feature flag's impact.
 */
export const featureFlagIssue: ScenarioWithMocks = {
	...createConfigScenario("feature-flag-misconfiguration", {
		difficulty: "hard",
		input: {
			investigationId: "eval-ff-001",
			incidentId: "inc-ff-001",
			priority: "high",
			incident: createIncident({
				incidentId: "inc-ff-001",
				title: "Sporadic checkout failures for specific user segment",
				description:
					"About 5% of users are experiencing checkout failures. " +
					"Pattern correlates with users in the 'beta_checkout_v2' feature flag group. " +
					"The flag was enabled with wrong targeting rule - matches enterprise users " +
					"but the v2 checkout doesn't support all enterprise payment methods.",
				severity: "high",
				serviceName: "checkout-service",
				customerImpact: "Enterprise users unable to complete checkout",
				alertCount: 2,
			}),
			alerts: [
				createAlert({
					alertId: "alert-ff-001",
					name: "CheckoutFailure",
					message: "Checkout payment processing failures",
					severity: "high",
					annotations: {
						error: "PaymentMethodNotSupported: invoice_payment",
						affected_segment: "enterprise",
						failure_rate: "100% for invoice payment",
						feature_flag: "beta_checkout_v2",
					},
				}),
				createAlert({
					alertId: "alert-ff-002",
					name: "ErrorRateSpike",
					message: "Error rate elevated for checkout-service",
					severity: "medium",
					annotations: {
						error_rate: "5%",
						baseline: "0.5%",
						error_type: "PaymentMethodNotSupported",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 35,
			rootCauseCategory: "config",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["feature", "flag", "beta", "targeting", "enterprise"],
		},
	}),
	mocks: {
		github: {
			searchCode: [
				{ file: "config/feature-flags.json", line: 15, snippet: '"targeting": "plan == enterprise"' },
				{ file: "src/checkout/v2/payment.ts", line: 8, snippet: "const SUPPORTED_METHODS = ['card', 'paypal'];" },
				{ file: "src/checkout/v1/payment.ts", line: 8, snippet: "const SUPPORTED_METHODS = ['card', 'paypal', 'invoice'];" },
			],
			getFile: {
				"config/feature-flags.json": `{
  "flags": {
    "beta_checkout_v2": {
      "enabled": true,
      "description": "New checkout experience with improved UX",
      "targeting": {
        "rules": [
          {
            "attribute": "plan",
            "operator": "equals",
            "value": "enterprise"
          }
        ],
        "percentage": 100
      },
      "notes": "BUG: Should target beta users, not enterprise users!"
    }
  }
}`,
				"src/checkout/v2/payment.ts": `// Checkout V2 Payment Handler
// NOTE: This is a simplified beta version - not all payment methods supported yet!

const SUPPORTED_METHODS = ['card', 'paypal'];  // Missing 'invoice'!

export async function processPayment(method: string, amount: number) {
  if (!SUPPORTED_METHODS.includes(method)) {
    throw new Error(\`PaymentMethodNotSupported: \${method}\`);
  }
  // ... payment logic
}`,
				"src/checkout/v1/payment.ts": `// Checkout V1 Payment Handler (Legacy)
// Full payment method support for all customer types

const SUPPORTED_METHODS = ['card', 'paypal', 'invoice', 'wire', 'ach'];

export async function processPayment(method: string, amount: number) {
  if (!SUPPORTED_METHODS.includes(method)) {
    throw new Error(\`PaymentMethodNotSupported: \${method}\`);
  }
  // ... payment logic
}`,
			},
			listCommits: [
				{
					sha: "ff123",
					message: "feat: enable beta_checkout_v2 for enterprise users (A/B test)",
					author: "pm@example.com",
					date: "2024-01-14T10:00:00Z",
				},
				{
					sha: "ff456",
					message: "feat: add checkout v2 with simplified payment options",
					author: "checkout-team@example.com",
					date: "2024-01-10T14:00:00Z",
				},
			],
		},
		render: {
			getLogs: [
				{
					timestamp: "2024-01-15T12:00:05Z",
					level: "error",
					message: "PaymentMethodNotSupported: invoice_payment for user enterprise-user-123",
				},
				{
					timestamp: "2024-01-15T12:00:04Z",
					level: "info",
					message: "Feature flag beta_checkout_v2 evaluated: true for user enterprise-user-123 (plan=enterprise)",
				},
				{
					timestamp: "2024-01-15T12:00:03Z",
					level: "info",
					message: "Checkout initiated for user enterprise-user-123 with payment method: invoice",
				},
			],
		},
	},
	solutionHint:
		"Feature flag targets enterprise users but checkout v2 doesn't support invoice payment. " +
		"Enterprise users commonly use invoice payment. Fix: change targeting to beta users or " +
		"add invoice support to v2.",
	tags: ["hard", "feature-flag", "targeting", "payment"],
};

/**
 * Subtle SSL/TLS configuration issue.
 * Certificate chain incomplete causing sporadic failures.
 */
export const sslConfigIssue: ScenarioWithMocks = {
	...createConfigScenario("ssl-certificate-chain", {
		difficulty: "hard",
		input: {
			investigationId: "eval-ssl-001",
			incidentId: "inc-ssl-001",
			priority: "high",
			incident: createIncident({
				incidentId: "inc-ssl-001",
				title: "Intermittent SSL handshake failures to external API",
				description:
					"Payment gateway integration failing intermittently. " +
					"Some requests succeed, others fail with SSL handshake error. " +
					"Pattern seems random but correlates with specific payment-service pods. " +
					"Issue: intermediate CA certificate missing from some pod trust stores.",
				severity: "high",
				serviceName: "payment-service",
				alertCount: 2,
			}),
			alerts: [
				createAlert({
					alertId: "alert-ssl-001",
					name: "SSLHandshakeFailed",
					message: "SSL/TLS handshake failure to payment gateway",
					severity: "high",
					annotations: {
						error: "unable to verify the first certificate",
						gateway_host: "api.paymentprovider.com",
						failure_rate: "~30%",
						affected_pods: "payment-service-7d8f9, payment-service-9c4e2",
					},
				}),
				createAlert({
					alertId: "alert-ssl-002",
					name: "PaymentFailure",
					message: "Payment processing failures elevated",
					severity: "high",
					annotations: {
						failure_count: "127",
						error_type: "ECONNRESET, SSL_ERROR",
						successful_pods: "payment-service-3a7b1, payment-service-5f2d8",
					},
				}),
			],
		},
		expected: {
			status: "completed",
			minConfidence: 30,
			rootCauseCategory: "config",
			shouldHaveRecommendations: true,
			rootCauseKeywords: ["SSL", "certificate", "chain", "trust", "CA"],
		},
	}),
	mocks: {
		github: {
			searchCode: [
				{ file: "deploy/payment-service.yaml", line: 35, snippet: "mountPath: /etc/ssl/certs" },
				{ file: "config/ssl/ca-certificates.crt", line: 1, snippet: "# CA Certificate Bundle" },
				{ file: "scripts/update-certs.sh", line: 12, snippet: "curl -o ca-bundle.crt https://..." },
			],
			getFile: {
				"deploy/payment-service.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
spec:
  replicas: 4
  template:
    spec:
      containers:
      - name: payment-service
        volumeMounts:
        - name: ca-certs
          mountPath: /etc/ssl/certs
          readOnly: true
      volumes:
      - name: ca-certs
        configMap:
          name: ca-certificates
          # BUG: Not all pods get updated configmap immediately
          # Pods 7d8f9 and 9c4e2 have stale certs without intermediate CA`,
				"scripts/update-certs.sh": `#!/bin/bash
# Update CA certificate bundle
# Last run: 2024-01-10

# Download latest CA bundle
curl -o ca-bundle.crt https://curl.se/ca/cacert.pem

# Add custom intermediate CA for payment provider
# BUG: This step was added manually on some nodes, not all!
# cat payment-provider-intermediate.pem >> ca-bundle.crt

kubectl create configmap ca-certificates \\
  --from-file=ca-bundle.crt \\
  --dry-run=client -o yaml | kubectl apply -f -

# NOTE: Pods need restart to pick up new certs!
echo "Remember to restart pods to apply new certificates"`,
			},
			listCommits: [
				{
					sha: "ssl123",
					message: "fix: add payment provider intermediate CA certificate",
					author: "security@example.com",
					date: "2024-01-10T09:00:00Z",
				},
				{
					sha: "ssl456",
					message: "chore: update CA certificate bundle",
					author: "ops@example.com",
					date: "2024-01-09T14:00:00Z",
				},
			],
		},
		render: {
			getLogs: [
				{
					timestamp: "2024-01-15T15:30:00Z",
					level: "error",
					message: "SSL handshake failed: unable to verify the first certificate (api.paymentprovider.com)",
				},
				{
					timestamp: "2024-01-15T15:29:55Z",
					level: "info",
					message: "Certificate chain: [leaf] -> [missing intermediate] -> [root]",
				},
				{
					timestamp: "2024-01-15T15:29:50Z",
					level: "info",
					message: "Connecting to payment gateway: api.paymentprovider.com:443",
				},
			],
			listServices: [
				{
					id: "srv-payment-1",
					name: "payment-service-7d8f9",
					status: "running",
					lastDeployedAt: "2024-01-08T10:00:00Z",
				},
				{
					id: "srv-payment-2",
					name: "payment-service-9c4e2",
					status: "running",
					lastDeployedAt: "2024-01-08T10:00:00Z",
				},
				{
					id: "srv-payment-3",
					name: "payment-service-3a7b1",
					status: "running",
					lastDeployedAt: "2024-01-10T11:00:00Z",
				},
				{
					id: "srv-payment-4",
					name: "payment-service-5f2d8",
					status: "running",
					lastDeployedAt: "2024-01-10T11:00:00Z",
				},
			],
		},
	},
	solutionHint:
		"Pods deployed before 2024-01-10 lack the intermediate CA certificate. " +
		"The update script added the cert but some pods weren't restarted. " +
		"Recommend rolling restart of all pods to pick up updated configmap.",
	tags: ["hard", "ssl", "certificate", "intermittent", "pods"],
};

// =============================================================================
// EXPORT ALL SCENARIOS
// =============================================================================

export const configIssueScenarios: ScenarioWithMocks[] = [
	connectionPoolExhausted,
	missingEnvVar,
	timeoutMisconfiguration,
	resourceLimits,
	featureFlagIssue,
	sslConfigIssue,
];

export const easyConfigScenarios = configIssueScenarios.filter(
	(s) => s.difficulty === "easy",
);

export const mediumConfigScenarios = configIssueScenarios.filter(
	(s) => s.difficulty === "medium",
);

export const hardConfigScenarios = configIssueScenarios.filter(
	(s) => s.difficulty === "hard",
);

// Legacy exports for backwards compatibility
export { connectionPoolExhausted as connectionPoolExhaustedScenario };
export { timeoutMisconfiguration as timeoutMisconfigurationScenario };
