/**
 * Scenario: Timeout cascade across services
 * Difficulty: MEDIUM
 *
 * Cascading connection timeouts across 3 services on Render.
 * Multiple alerts from different services exercise extractServiceTopology.
 */

import type { ScenarioDefinition } from "../types.js"
import { makeTimeline } from "../timeline.js"
import {
  buildServicesResponse,
  buildDeploysResponse,
  buildLogsResponse,
} from "../fixtures/render-responses.js"

const t = makeTimeline()

export const TIMEOUT_CASCADE: ScenarioDefinition = {
  id: "timeout-cascade",
  name: "Timeout cascade across services",
  category: "config_issue",
  difficulty: "medium",
  tags: ["render", "cascade", "timeout", "multi-service"],

  incident: {
    incidentId: "inc-cascade-001",
    number: 105,
    title: "Cascading timeouts across API gateway, order-service, and inventory-service",
    description:
      "API gateway timing out on requests to order-service, which is timing out on calls to inventory-service. Root cause appears to be inventory-service connection issues.",
    severity: "critical",
    status: "investigating",
    priority: "p1",
    serviceName: "api-gateway",
    serviceId: "srv-gateway",
    alertCount: 8,
    triggeredAt: t.minus({ minutes: 20 }),
    affectedSystems: ["api-gateway", "order-service", "inventory-service"],
  },

  alerts: [
    // Inventory-service alerts (root cause)
    {
      alertId: "alert-casc-1",
      title: "inventory-service database connection timeout",
      severity: "high",
      status: "triggered",
      source: "render",
      serviceName: "inventory-service",
      triggeredAt: t.minus({ minutes: 20 }),
    },
    {
      alertId: "alert-casc-2",
      title: "inventory-service response time > 30s",
      severity: "high",
      status: "triggered",
      source: "render",
      serviceName: "inventory-service",
      triggeredAt: t.minus({ minutes: 19 }),
    },
    // Order-service alerts (downstream impact)
    {
      alertId: "alert-casc-3",
      title: "order-service timeout calling inventory-service",
      severity: "high",
      status: "triggered",
      source: "render",
      serviceName: "order-service",
      triggeredAt: t.minus({ minutes: 18 }),
    },
    {
      alertId: "alert-casc-4",
      title: "order-service error rate spike (50%)",
      severity: "high",
      status: "triggered",
      source: "render",
      serviceName: "order-service",
      triggeredAt: t.minus({ minutes: 17 }),
    },
    {
      alertId: "alert-casc-5",
      title: "order-service circuit breaker opened for inventory-service",
      severity: "medium",
      status: "triggered",
      source: "render",
      serviceName: "order-service",
      triggeredAt: t.minus({ minutes: 16 }),
    },
    // Gateway alerts (furthest downstream)
    {
      alertId: "alert-casc-6",
      title: "api-gateway 504 errors on /api/orders",
      severity: "critical",
      status: "triggered",
      source: "render",
      serviceName: "api-gateway",
      triggeredAt: t.minus({ minutes: 15 }),
    },
    {
      alertId: "alert-casc-7",
      title: "api-gateway 504 errors on /api/inventory",
      severity: "critical",
      status: "triggered",
      source: "render",
      serviceName: "api-gateway",
      triggeredAt: t.minus({ minutes: 14 }),
    },
    {
      alertId: "alert-casc-8",
      title: "api-gateway overall error rate > 30%",
      severity: "critical",
      status: "triggered",
      source: "render",
      serviceName: "api-gateway",
      triggeredAt: t.minus({ minutes: 13 }),
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
        { id: "srv-gateway", name: "api-gateway" },
        { id: "srv-orders", name: "order-service" },
        { id: "srv-inventory", name: "inventory-service" },
      ]),
    },
    // Inventory-service logs (root cause)
    {
      integration: "render",
      pathPattern: /\/v1\/services\/srv-inventory\/logs/,
      responseBody: buildLogsResponse([
        {
          timestamp: t.minus({ minutes: 20 }),
          message:
            "ERROR Connection to database timed out after 30000ms. Host: db-inventory.internal:5432",
          level: "error",
        },
        {
          timestamp: t.minus({ minutes: 19 }),
          message:
            "ERROR Pool exhausted: 0 idle, 20 active, 20 max. All connections stuck waiting for db response.",
          level: "error",
        },
        {
          timestamp: t.minus({ minutes: 18 }),
          message:
            "WARN Incoming requests queuing. Avg response time: 31500ms (threshold: 5000ms)",
          level: "warn",
        },
      ]),
    },
    // Order-service logs
    {
      integration: "render",
      pathPattern: /\/v1\/services\/srv-orders\/logs/,
      responseBody: buildLogsResponse([
        {
          timestamp: t.minus({ minutes: 18 }),
          message:
            "ERROR Timeout calling inventory-service at http://inventory-service:8080/api/stock after 10000ms",
          level: "error",
        },
        {
          timestamp: t.minus({ minutes: 16 }),
          message:
            "WARN Circuit breaker OPEN for inventory-service. Failure rate: 85% (threshold: 50%)",
          level: "warn",
        },
      ]),
    },
    // Gateway logs
    {
      integration: "render",
      pathPattern: /\/v1\/services\/srv-gateway\/logs/,
      responseBody: buildLogsResponse([
        {
          timestamp: t.minus({ minutes: 15 }),
          message:
            "ERROR 504 Gateway Timeout: upstream order-service did not respond within 15000ms",
          level: "error",
        },
        {
          timestamp: t.minus({ minutes: 14 }),
          message:
            "ERROR 504 Gateway Timeout: upstream inventory-service did not respond within 15000ms",
          level: "error",
        },
      ]),
    },
    // Deploys (no recent deploys — config/infra issue)
    {
      integration: "render",
      pathPattern: /\/v1\/services\/srv-inventory\/deploys/,
      responseBody: buildDeploysResponse([
        {
          id: "dep-inv-010",
          status: "live",
          commitMessage: "chore: routine dependency update",
          createdAt: t.minus({ hours: 72 }),
        },
      ]),
    },
  ],

  expectation: {
    status: "completed",
    rootCauseKeywords: ["timeout", "inventory"],
    trajectorySubsequence: ["scout", "analyst", "supervisor"],
    hasSummary: true,
  },
}
