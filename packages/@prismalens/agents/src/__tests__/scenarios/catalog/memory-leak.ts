/**
 * Scenario: Memory leak with GitHub code + Render logs
 * Difficulty: MEDIUM
 *
 * Gradual heap growth over 24h caused by an unbounded cache in
 * UserCache.java. Multiple alerts show timeline progression.
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

export const MEMORY_LEAK: ScenarioDefinition = {
  id: "memory-leak",
  name: "Memory leak from unbounded cache",
  category: "code_bug",
  difficulty: "medium",
  tags: ["github", "render", "memory", "cache", "gradual"],

  incident: {
    incidentId: "inc-mem-001",
    number: 91,
    title: "Gradual memory increase causing OOM kills on user-service",
    description:
      "user-service pods being OOM-killed after 24h of uptime. Heap usage grows linearly without stabilizing.",
    severity: "high",
    status: "investigating",
    priority: "p2",
    serviceName: "user-service",
    serviceId: "srv-users",
    alertCount: 6,
    triggeredAt: t.minus({ hours: 2 }),
    affectedSystems: ["user-service"],
  },

  alerts: [
    {
      alertId: "alert-mem-1",
      title: "Memory usage warning on user-service (70%)",
      severity: "low",
      status: "triggered",
      source: "render",
      serviceName: "user-service",
      triggeredAt: t.minus({ hours: 24 }),
    },
    {
      alertId: "alert-mem-2",
      title: "Memory usage elevated on user-service (80%)",
      severity: "medium",
      status: "triggered",
      source: "render",
      serviceName: "user-service",
      triggeredAt: t.minus({ hours: 18 }),
    },
    {
      alertId: "alert-mem-3",
      title: "Memory usage high on user-service (85%)",
      severity: "medium",
      status: "triggered",
      source: "render",
      serviceName: "user-service",
      triggeredAt: t.minus({ hours: 12 }),
    },
    {
      alertId: "alert-mem-4",
      title: "Memory usage critical on user-service (90%)",
      severity: "high",
      status: "triggered",
      source: "render",
      serviceName: "user-service",
      triggeredAt: t.minus({ hours: 6 }),
    },
    {
      alertId: "alert-mem-5",
      title: "OOM kill on user-service instance user-service-pod-1",
      severity: "critical",
      status: "triggered",
      source: "render",
      serviceName: "user-service",
      triggeredAt: t.minus({ hours: 2 }),
    },
    {
      alertId: "alert-mem-6",
      title: "OOM kill on user-service instance user-service-pod-2",
      severity: "critical",
      status: "triggered",
      source: "render",
      serviceName: "user-service",
      triggeredAt: t.minus({ hours: 1, minutes: 30 }),
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
    {
      integration: "render",
      pathPattern: "/v1/services",
      responseBody: buildServicesResponse([
        { id: "srv-users", name: "user-service", status: "deployed" },
      ]),
    },
    {
      integration: "render",
      pathPattern: /\/v1\/services\/srv-users\/logs/,
      responseBody: buildLogsResponse([
        {
          timestamp: t.minus({ hours: 24 }),
          message:
            "INFO Heap usage: 350MB / 512MB (68%). UserCache entries: 15000",
          level: "info",
        },
        {
          timestamp: t.minus({ hours: 12 }),
          message:
            "WARN Heap usage: 440MB / 512MB (86%). UserCache entries: 45000",
          level: "warn",
        },
        {
          timestamp: t.minus({ hours: 6 }),
          message:
            "WARN Heap usage: 470MB / 512MB (92%). UserCache entries: 72000. GC unable to reclaim memory.",
          level: "warn",
        },
        {
          timestamp: t.minus({ hours: 2 }),
          message:
            "ERROR java.lang.OutOfMemoryError: Java heap space",
          level: "error",
        },
        {
          timestamp: t.minus({ hours: 2 }),
          message:
            "ERROR Container killed due to OOM. Memory limit: 512MB, Usage: 512MB",
          level: "error",
        },
      ]),
    },
    {
      integration: "github",
      pathPattern: /\/repos\/.*\/commits/,
      responseBody: buildCommitsResponse([
        {
          sha: "ccc333d",
          message: "feat: add user caching for performance",
          author: "dev@example.com",
          date: t.minus({ hours: 48 }),
        },
      ]),
    },
    {
      integration: "github",
      pathPattern: "/search/code",
      responseBody: buildCodeSearchResponse([
        {
          name: "UserCache.java",
          path: "src/main/java/com/example/UserCache.java",
          repository: "example/user-service",
          textMatches: [
            "private final Map<String, User> cache = new HashMap<>(); // no eviction policy",
            "private static final int MAX_AGE = 3600; // declared but never enforced",
          ],
        },
      ]),
    },
    {
      integration: "github",
      pathPattern: /\/repos\/.*\/contents\//,
      responseBody: buildFileContentResponse(
        "src/main/java/com/example/UserCache.java",
        `public class UserCache {
    private final Map<String, User> cache = new HashMap<>();
    private static final int MAX_AGE = 3600; // never enforced

    public void put(String userId, User user) {
        cache.put(userId, user); // grows unbounded
    }

    public User get(String userId) {
        return cache.get(userId);
    }

    // No eviction, no size limit, no TTL enforcement
}`,
      ),
    },
  ],

  expectation: {
    status: "completed",
    rootCauseKeywords: ["memory", "cache"],
    rootCauseCategory: "code",
    trajectorySubsequence: ["scout", "analyst", "supervisor"],
    hasSummary: true,
  },
}
