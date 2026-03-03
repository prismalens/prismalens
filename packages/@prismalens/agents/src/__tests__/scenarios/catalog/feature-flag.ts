/**
 * Scenario: Feature flag targeting bug
 * Difficulty: HARD
 *
 * Intermittent failures correlated with a feature flag that has a wrong
 * targeting rule in the GitHub config. Only affects users matching a
 * specific segment.
 */

import type { ScenarioDefinition } from "../types.js"
import { makeTimeline } from "../timeline.js"
import {
  buildCommitsResponse,
  buildCodeSearchResponse,
  buildFileContentResponse,
} from "../fixtures/github-responses.js"
import {
  buildServicesResponse,
  buildLogsResponse,
} from "../fixtures/render-responses.js"

const t = makeTimeline()

export const FEATURE_FLAG: ScenarioDefinition = {
  id: "feature-flag",
  name: "Feature flag targeting bug causes intermittent failures",
  category: "config_issue",
  difficulty: "hard",
  tags: ["github", "render", "feature-flag", "intermittent"],

  incident: {
    incidentId: "inc-ff-001",
    number: 128,
    title: "Intermittent 500 errors on checkout for ~15% of users",
    description:
      "Some users hitting 500 errors during checkout. Pattern is inconsistent — same user may succeed on retry. Error rate correlates with feature flag rollout percentage.",
    severity: "high",
    status: "investigating",
    priority: "p2",
    serviceName: "checkout-service",
    serviceId: "srv-checkout",
    alertCount: 4,
    triggeredAt: t.minus({ hours: 3 }),
    affectedSystems: ["checkout-service"],
  },

  alerts: [
    {
      alertId: "alert-ff-1",
      title: "Elevated 500 error rate on /api/checkout",
      description:
        "Error rate at 15% (threshold: 5%). Errors are intermittent.",
      severity: "high",
      status: "triggered",
      source: "render",
      serviceName: "checkout-service",
      triggeredAt: t.minus({ hours: 3 }),
    },
    {
      alertId: "alert-ff-2",
      title: "Checkout conversion rate dropped",
      description:
        "Checkout conversion dropped from 85% to 72% over the last 3 hours",
      severity: "medium",
      status: "triggered",
      source: "render",
      serviceName: "checkout-service",
      triggeredAt: t.minus({ hours: 2 }),
    },
    {
      alertId: "alert-ff-3",
      title: "TypeError in checkout flow",
      description:
        "TypeError: Cannot read properties of undefined (reading 'applyDiscount')",
      severity: "high",
      status: "triggered",
      source: "render",
      serviceName: "checkout-service",
      triggeredAt: t.minus({ hours: 2, minutes: 30 }),
      labels: { feature_flag: "new-discount-engine", error_type: "TypeError" },
    },
    {
      alertId: "alert-ff-4",
      title: "Customer complaints about checkout failures",
      description:
        "15 customer reports of checkout failures in the last 2 hours",
      severity: "medium",
      status: "triggered",
      source: "render",
      serviceName: "checkout-service",
      triggeredAt: t.minus({ hours: 1 }),
    },
  ],

  changeEvents: [
    {
      id: "ce-ff-1",
      type: "config",
      source: "github",
      description:
        "Feature flag 'new-discount-engine' rollout increased to 15%",
      timestamp: t.minus({ hours: 4 }),
      serviceId: "srv-checkout",
      metadata: {
        flag: "new-discount-engine",
        previousPercentage: 0,
        newPercentage: 15,
      },
      riskScore: 0.5,
    },
  ],

  integrations: [
    {
      id: "int-github-1",
      name: "GitHub",
      type: "github",
      enabled: true,
      config: {},
      credentials: { apiKey: "ghp_test_token" },
    },
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
    // Specific routes FIRST — general "/v1/services" string pattern is greedy (startsWith)
    {
      integration: "render",
      pathPattern: /\/v1\/services\/srv-checkout\/logs/,
      responseBody: buildLogsResponse([
        {
          timestamp: t.minus({ hours: 3 }),
          message:
            "INFO Feature flag 'new-discount-engine' evaluated: true for user usr-abc (segment: beta-users)",
          level: "info",
        },
        {
          timestamp: t.minus({ hours: 3 }),
          message:
            "ERROR TypeError: Cannot read properties of undefined (reading 'applyDiscount') at CheckoutService.processOrder",
          level: "error",
        },
        {
          timestamp: t.minus({ hours: 2, minutes: 45 }),
          message:
            "INFO Feature flag 'new-discount-engine' evaluated: false for user usr-def (segment: general)",
          level: "info",
        },
        {
          timestamp: t.minus({ hours: 2, minutes: 45 }),
          message:
            "INFO Checkout completed successfully for user usr-def",
          level: "info",
        },
        {
          timestamp: t.minus({ hours: 2, minutes: 30 }),
          message:
            "ERROR TypeError: Cannot read properties of undefined (reading 'applyDiscount') — flag 'new-discount-engine' active",
          level: "error",
        },
      ]),
    },
    // General route LAST — string pattern uses startsWith, would capture specific paths
    {
      integration: "render",
      pathPattern: "/v1/services",
      responseBody: buildServicesResponse([
        { id: "srv-checkout", name: "checkout-service" },
      ]),
    },
    {
      integration: "github",
      pathPattern: /\/repos\/.*\/commits/,
      responseBody: buildCommitsResponse([
        {
          sha: "eee555g",
          message: "feat: implement new discount engine behind feature flag",
          author: "dev@example.com",
          date: t.minus({ hours: 48 }),
        },
        {
          sha: "fff666h",
          message:
            "chore: update feature flag config — enable new-discount-engine at 15%",
          author: "pm@example.com",
          date: t.minus({ hours: 4 }),
        },
      ]),
    },
    {
      integration: "github",
      pathPattern: "/search/code",
      responseBody: buildCodeSearchResponse([
        {
          name: "feature-flags.json",
          path: "config/feature-flags.json",
          repository: "example/checkout-service",
          textMatches: [
            '"new-discount-engine": { "enabled": true, "percentage": 15, "discountService": null }',
          ],
        },
        {
          name: "CheckoutService.ts",
          path: "src/services/CheckoutService.ts",
          repository: "example/checkout-service",
          textMatches: [
            "if (flags.get('new-discount-engine')) { return config.discountService.applyDiscount(order) }",
          ],
        },
      ]),
    },
    {
      integration: "github",
      pathPattern: /\/repos\/.*\/contents\/config\/feature-flags/,
      responseBody: buildFileContentResponse(
        "config/feature-flags.json",
        JSON.stringify(
          {
            "new-discount-engine": {
              enabled: true,
              percentage: 15,
              discountService: null,
            },
          },
          null,
          2,
        ),
      ),
    },
    {
      integration: "github",
      pathPattern: /\/repos\/.*\/contents\/src\//,
      responseBody: buildFileContentResponse(
        "src/services/CheckoutService.ts",
        `export class CheckoutService {
  async processOrder(order: Order, flags: FeatureFlags) {
    const config = flags.getConfig('new-discount-engine');
    if (flags.isEnabled('new-discount-engine')) {
      // BUG: config.discountService is null in feature-flags.json
      // but code assumes it's always defined when flag is enabled
      return config.discountService.applyDiscount(order);
    }
    return this.legacyDiscount(order);
  }
}`,
      ),
    },
  ],

  expectation: {
    status: "completed",
    rootCauseKeywords: ["feature", "flag"],
    trajectorySubsequence: ["scout", "analyst", "supervisor"],
    hasSummary: true,
  },
}
