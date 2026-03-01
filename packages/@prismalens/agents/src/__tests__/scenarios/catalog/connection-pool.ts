/**
 * Scenario: DB connection pool exhausted
 * Difficulty: EASY
 *
 * Database connection pool was reduced from 100 to 10 via config change,
 * causing pool exhaustion under normal load. A similar past incident exists.
 */

import type { ScenarioDefinition } from "../types.js"
import { makeTimeline } from "../timeline.js"
import {
  buildServicesResponse,
  buildDeploysResponse,
  buildLogsResponse,
} from "../fixtures/render-responses.js"

const t = makeTimeline()

export const CONNECTION_POOL: ScenarioDefinition = {
  id: "connection-pool",
  name: "DB connection pool exhausted after config change",
  category: "config_issue",
  difficulty: "easy",
  tags: ["render", "database", "config", "connection-pool"],

  incident: {
    incidentId: "inc-pool-001",
    number: 73,
    title: "Database connection pool exhaustion — queries timing out",
    description:
      "order-service experiencing database connection timeouts. Pool exhausted after config change reduced DB_POOL_SIZE from 100 to 10.",
    severity: "high",
    status: "investigating",
    priority: "p2",
    serviceName: "order-service",
    serviceId: "srv-orders",
    alertCount: 2,
    triggeredAt: t.minus({ minutes: 45 }),
    affectedSystems: ["order-service"],
  },

  alerts: [
    {
      alertId: "alert-pool-1",
      title: "Database connection timeout on order-service",
      description:
        "Multiple database queries timing out. Connection pool at capacity.",
      severity: "high",
      status: "triggered",
      source: "render",
      serviceName: "order-service",
      triggeredAt: t.minus({ minutes: 45 }),
    },
    {
      alertId: "alert-pool-2",
      title: "Response time degradation on order-service",
      description: "p95 latency exceeded 10s threshold",
      severity: "medium",
      status: "triggered",
      source: "render",
      serviceName: "order-service",
      triggeredAt: t.minus({ minutes: 40 }),
    },
  ],

  changeEvents: [
    {
      id: "ce-pool-1",
      type: "config",
      source: "render",
      description: "DB_POOL_SIZE changed from 100 to 10",
      timestamp: t.minus({ hours: 2 }),
      serviceId: "srv-orders",
      metadata: {
        key: "DB_POOL_SIZE",
        oldValue: "100",
        newValue: "10",
      },
      riskScore: 0.8,
    },
  ],

  similarIncidents: [
    {
      incidentId: "inc-pool-past-001",
      title: "DB connection pool exhaustion on user-service",
      similarity: 0.85,
      rootCause: "DB_POOL_SIZE was reduced during cost optimization",
      rootCauseCategory: "configuration",
      resolution: "Restored DB_POOL_SIZE to previous value of 100",
      timeToResolve: 1800,
      resolvedAt: t.minus({ hours: 720 }),
    },
  ],

  integrations: [
    {
      id: "int-render-1",
      name: "Render",
      type: "render",
      enabled: true,
      config: {},
      credentials: { apiKey: "rnd_test_key" },
    },
  ],

  httpMocks: [
    {
      integration: "render",
      pathPattern: "/v1/services",
      responseBody: buildServicesResponse([
        { id: "srv-orders", name: "order-service", status: "deployed" },
      ]),
    },
    {
      integration: "render",
      pathPattern: /\/v1\/services\/srv-orders\/deploys/,
      responseBody: buildDeploysResponse([
        {
          id: "dep-ord-003",
          status: "live",
          commitMessage: "chore: reduce DB pool size for cost savings",
          commitSha: "bbb222c",
          createdAt: t.minus({ hours: 2 }),
        },
      ]),
    },
    {
      integration: "render",
      pathPattern: /\/v1\/services\/srv-orders\/logs/,
      responseBody: buildLogsResponse([
        {
          timestamp: t.minus({ minutes: 45 }),
          message:
            "WARN Connection pool exhausted (active: 10, max: 10). Waiting for available connection...",
          level: "warn",
        },
        {
          timestamp: t.minus({ minutes: 44 }),
          message:
            "ERROR Timeout acquiring database connection after 30000ms. Pool: active=10, idle=0, max=10",
          level: "error",
        },
        {
          timestamp: t.minus({ minutes: 43 }),
          message:
            "ERROR org.postgresql.util.PSQLException: Cannot acquire connection from pool",
          level: "error",
        },
        {
          timestamp: t.minus({ minutes: 42 }),
          message:
            "WARN DB_POOL_SIZE is set to 10. Previous value was 100.",
          level: "warn",
        },
      ]),
    },
  ],

  expectation: {
    status: "completed",
    rootCauseKeywords: ["pool", "connection"],
    trajectorySubsequence: ["scout", "analyst", "supervisor"],
    hasSummary: true,
  },
}
