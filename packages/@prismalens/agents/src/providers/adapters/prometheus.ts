import type { IntegrationAdapter } from "../integration-registry.js"

export const prometheusAdapter: IntegrationAdapter = {
  type: "prometheus",
  defaultBaseUrl: "http://localhost:9090",
  // specFileName: not yet available — add prometheus-openapi.json to specs/ when ready
  dataSources: ["metrics"],
  authenticate: {
    basic: {
      username: "{{credentials.username}}",
      password: "{{credentials.apiKey}}",
    },
  },
  envVars: {
    PROMETHEUS_BASE_URL: "{{config.baseUrl}}",
  },
  testRequest: { path: "/api/v1/status/buildinfo" },
  fromEnv: {
    credentials: { username: "PROMETHEUS_USERNAME", apiKey: "PROMETHEUS_PASSWORD" },
    config: { baseUrl: "PROMETHEUS_BASE_URL" },
  },
}
