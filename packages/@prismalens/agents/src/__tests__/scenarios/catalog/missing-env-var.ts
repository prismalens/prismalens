/**
 * Scenario: Missing environment variable + Render deploy failure
 * Difficulty: EASY
 *
 * A failed deployment on Render where DATABASE_URL was not defined,
 * causing the application to crash on startup.
 */

import type { ScenarioDefinition } from "../types.js"
import { makeTimeline } from "../timeline.js"
import {
  buildServicesResponse,
  buildDeploysResponse,
  buildLogsResponse,
} from "../fixtures/render-responses.js"

const t = makeTimeline()

export const MISSING_ENV_VAR: ScenarioDefinition = {
  id: "missing-env-var",
  name: "Missing DATABASE_URL causes deploy failure",
  category: "config_issue",
  difficulty: "easy",
  tags: ["render", "config", "env-var"],

  incident: {
    incidentId: "inc-env-001",
    number: 58,
    title: "Application crash after deployment — DATABASE_URL not defined",
    description:
      "payment-service failed to start after deployment. Logs show DATABASE_URL environment variable is missing.",
    severity: "critical",
    status: "investigating",
    priority: "p1",
    serviceName: "payment-service",
    serviceId: "srv-payment",
    alertCount: 2,
    triggeredAt: t.minus({ minutes: 15 }),
    affectedSystems: ["payment-service"],
  },

  alerts: [
    {
      alertId: "alert-env-1",
      title: "payment-service deploy failed",
      description:
        "Deployment dep-pay-002 for payment-service failed with exit code 1",
      severity: "critical",
      status: "triggered",
      source: "render",
      serviceName: "payment-service",
      triggeredAt: t.minus({ minutes: 15 }),
    },
    {
      alertId: "alert-env-2",
      title: "payment-service health check failing",
      description:
        "Health check endpoint /health returning 503 for payment-service",
      severity: "critical",
      status: "triggered",
      source: "render",
      serviceName: "payment-service",
      triggeredAt: t.minus({ minutes: 14 }),
    },
  ],

  changeEvents: [
    {
      id: "ce-env-1",
      type: "deployment",
      source: "render",
      description: "Deployed payment-service v1.8.0",
      timestamp: t.minus({ minutes: 20 }),
      serviceId: "srv-payment",
      metadata: { commitSha: "fed789b" },
      riskScore: 0.7,
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
        { id: "srv-payment", name: "payment-service", status: "deploy_failed" },
      ]),
    },
    {
      integration: "render",
      pathPattern: /\/v1\/services\/srv-payment\/deploys/,
      responseBody: buildDeploysResponse([
        {
          id: "dep-pay-002",
          status: "build_failed",
          commitMessage: "refactor: migrate to new DB connection library",
          commitSha: "fed789b",
          createdAt: t.minus({ minutes: 20 }),
          finishedAt: t.minus({ minutes: 18 }),
        },
        {
          id: "dep-pay-001",
          status: "live",
          commitMessage: "fix: update payment validation",
          commitSha: "aaa111b",
          createdAt: t.minus({ hours: 48 }),
          finishedAt: t.minus({ hours: 48, minutes: -5 }),
        },
      ]),
    },
    {
      integration: "render",
      pathPattern: /\/v1\/services\/srv-payment\/logs/,
      responseBody: buildLogsResponse([
        {
          timestamp: t.minus({ minutes: 18 }),
          message: "Starting payment-service v1.8.0...",
          level: "info",
        },
        {
          timestamp: t.minus({ minutes: 18 }),
          message:
            "Error: DATABASE_URL environment variable is not defined",
          level: "error",
        },
        {
          timestamp: t.minus({ minutes: 18 }),
          message:
            "Error: Cannot connect to database — connection string is undefined",
          level: "error",
        },
        {
          timestamp: t.minus({ minutes: 18 }),
          message: "Process exited with code 1",
          level: "error",
        },
      ]),
    },
  ],

  expectation: {
    status: "completed",
    rootCauseKeywords: ["DATABASE_URL", "environment"],
    trajectorySubsequence: ["scout", "analyst", "supervisor"],
    hasSummary: true,
  },
}
