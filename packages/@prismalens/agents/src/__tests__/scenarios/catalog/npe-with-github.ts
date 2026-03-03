/**
 * Scenario: NPE with GitHub code + Render logs
 * Difficulty: EASY
 *
 * A NullPointerException in Render logs traced to a GitHub commit that
 * removed a null check in UserService.java.
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
  buildDeploysResponse,
  buildLogsResponse,
} from "../fixtures/render-responses.js"

const t = makeTimeline()

export const NPE_WITH_GITHUB: ScenarioDefinition = {
  id: "npe-with-github",
  name: "NullPointerException traced to GitHub commit",
  category: "code_bug",
  difficulty: "easy",
  tags: ["github", "render", "npe", "java"],

  incident: {
    incidentId: "inc-npe-001",
    number: 42,
    title: "NullPointerException in UserService causing 500 errors",
    description:
      "Production API returning 500 errors with NullPointerException in UserService.getProfile()",
    severity: "high",
    status: "investigating",
    priority: "p2",
    serviceName: "user-api",
    serviceId: "srv-user-api",
    alertCount: 3,
    triggeredAt: t.minus({ minutes: 30 }),
    affectedSystems: ["user-api"],
  },

  alerts: [
    {
      alertId: "alert-npe-1",
      title: "High error rate on /api/users/profile",
      description:
        "Error rate exceeded 5% threshold on user-api /api/users/profile endpoint",
      severity: "high",
      status: "triggered",
      source: "render",
      serviceName: "user-api",
      triggeredAt: t.minus({ minutes: 30 }),
    },
    {
      alertId: "alert-npe-2",
      title: "NullPointerException in UserService.getProfile",
      description:
        "java.lang.NullPointerException at UserService.getProfile(UserService.java:45)",
      severity: "high",
      status: "triggered",
      source: "render",
      serviceName: "user-api",
      triggeredAt: t.minus({ minutes: 28 }),
      labels: { exception: "NullPointerException", method: "getProfile" },
    },
    {
      alertId: "alert-npe-3",
      title: "Response time p99 spike on user-api",
      description: "p99 latency exceeded 5s on user-api",
      severity: "medium",
      status: "triggered",
      source: "render",
      serviceName: "user-api",
      triggeredAt: t.minus({ minutes: 25 }),
    },
  ],

  changeEvents: [
    {
      id: "ce-npe-1",
      type: "deployment",
      source: "render",
      description: "Deployed user-api v2.3.1",
      timestamp: t.minus({ hours: 1 }),
      serviceId: "srv-user-api",
      metadata: { commitSha: "abc123f" },
      riskScore: 0.6,
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
    // Render: deploys for user-api
    {
      integration: "render",
      pathPattern: /\/v1\/services\/srv-user-api\/deploys/,
      responseBody: buildDeploysResponse([
        {
          id: "dep-001",
          status: "live",
          commitMessage: "perf: optimize user cache lookup",
          commitSha: "abc123f",
          createdAt: t.minus({ hours: 1 }),
        },
      ]),
    },
    // Render: logs for user-api
    {
      integration: "render",
      pathPattern: /\/v1\/services\/srv-user-api\/logs/,
      responseBody: buildLogsResponse([
        {
          timestamp: t.minus({ minutes: 30 }),
          message:
            "ERROR java.lang.NullPointerException at com.example.UserService.getProfile(UserService.java:45)",
          level: "error",
        },
        {
          timestamp: t.minus({ minutes: 30 }),
          message:
            "ERROR Caused by: user.getCache() returned null after cache optimization",
          level: "error",
        },
        {
          timestamp: t.minus({ minutes: 29 }),
          message:
            "ERROR java.lang.NullPointerException at com.example.UserService.getProfile(UserService.java:45)",
          level: "error",
        },
      ]),
    },
    // GitHub: commits on repo
    {
      integration: "github",
      pathPattern: /\/repos\/.*\/commits/,
      responseBody: buildCommitsResponse([
        {
          sha: "abc123f",
          message:
            "perf: optimize user cache lookup — removed null check for performance",
          author: "dev@example.com",
          date: t.minus({ hours: 2 }),
        },
        {
          sha: "def456a",
          message: "feat: add user profile avatar support",
          author: "dev2@example.com",
          date: t.minus({ hours: 24 }),
        },
      ]),
    },
    // GitHub: code search for NullPointerException
    {
      integration: "github",
      pathPattern: "/search/code",
      responseBody: buildCodeSearchResponse([
        {
          name: "UserService.java",
          path: "src/main/java/com/example/UserService.java",
          repository: "example/user-api",
          textMatches: [
            'User user = cache.get(userId); // null check removed in abc123f\nreturn user.getProfile(); // NPE here when cache miss',
          ],
        },
      ]),
    },
    // General route LAST — string pattern uses startsWith, would capture specific paths
    {
      integration: "render",
      pathPattern: "/v1/services",
      responseBody: buildServicesResponse([
        { id: "srv-user-api", name: "user-api", status: "deployed" },
      ]),
    },
    // GitHub: file content
    {
      integration: "github",
      pathPattern: /\/repos\/.*\/contents\//,
      responseBody: buildFileContentResponse(
        "src/main/java/com/example/UserService.java",
        `public class UserService {
    private final UserCache cache;

    public UserProfile getProfile(String userId) {
        User user = cache.get(userId); // cache miss returns null
        return user.getProfile(); // NPE when user is null
    }
}`,
      ),
    },
  ],

  expectation: {
    status: "completed",
    minConfidence: 0.5,
    rootCauseKeywords: ["null", "cache"],
    rootCauseCategory: "code",
    trajectorySubsequence: ["scout", "analyst", "supervisor"],
    hasSummary: true,
    hasRecommendations: true,
  },
}
