---
name: render-logs
description: Fetch and analyze Render.com service logs and deployments via http_request
metadata:
  requiredIntegrations: render
---

# Render Logs & Deployments

Gather logs and deployment data from Render.com services.

## Quick Reference

Use `http_request` with `integration: "render"`:

### Get service logs
```
http_request({
  integration: "render",
  method: "GET",
  path: "/v1/services/{serviceId}/logs",
  pathParams: { serviceId: "<service_id>" },
  queryParams: { limit: "200", direction: "backward" }
})
```

### List recent deploys
```
http_request({
  integration: "render",
  method: "GET",
  path: "/v1/services/{serviceId}/deploys",
  pathParams: { serviceId: "<service_id>" },
  queryParams: { limit: "10" }
})
```

### List all services
```
http_request({
  integration: "render",
  method: "GET",
  path: "/v1/services",
  queryParams: { limit: "50" }
})
```

## Methodology

1. **Identify services**: List services or use known service IDs from the incident context
2. **Fetch logs**: Get logs around the incident time window (use startTime/endTime query params)
3. **Check deployments**: List recent deploys — look for deployments shortly before incident
4. **Cross-reference**: Match deploy timestamps with error log onset times

## API Discovery

For endpoints beyond the quick reference above, use `render_routes` to discover all available API endpoints and their parameters.

## Script Templates

Reference scripts in `scripts/` for common operations.
Use `ls` then `read_file` to find relevant templates, adapt for the current investigation.
