import type { IntegrationAdapter } from "../integration-registry.js"

export const githubAdapter: IntegrationAdapter = {
  type: "github",
  defaultBaseUrl: "https://api.github.com",
  dataSources: ["code", "commits"],
  authenticate: {
    headers: {
      Authorization: "Bearer {{credentials.apiKey|credentials.accessToken}}",
    },
  },
  envVars: {
    GITHUB_TOKEN: "{{credentials.apiKey|credentials.accessToken}}",
    GITHUB_BASE_URL: "{{config.baseUrl}}",
  },
  gitAuth: {
    cloneUrlTemplate:
      "https://x-access-token:{{credentials.apiKey|credentials.accessToken}}@github.com",
  },
  testRequest: { path: "/user" },
  fromEnv: {
    credentials: { apiKey: "GITHUB_TOKEN" },
    config: { baseUrl: "GITHUB_BASE_URL" },
  },
}
