import type { IntegrationAdapter } from "../integration-registry.js"

export const renderAdapter: IntegrationAdapter = {
  type: "render",
  defaultBaseUrl: "https://api.render.com",
  specFileName: "render-openapi.json",
  dataSources: ["logs", "deployments"],
  authenticate: {
    headers: { Authorization: "Bearer {{credentials.apiKey}}" },
  },
  envVars: {
    RENDER_API_KEY: "{{credentials.apiKey}}",
    RENDER_BASE_URL: "{{config.baseUrl}}",
  },
  testRequest: { path: "/v1/owners" },
}
