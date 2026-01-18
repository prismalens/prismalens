---
name: render-logs
category: render
description: Fetch logs and deployment information from Render.com services. Provides tools for retrieving service logs, listing services, and checking deployment history.
readOnly: true
estimatedTokens: 750
keywords: [render, logs, deployment, services, hosting, paas]
---

# Render.com Tools

Tools for interacting with Render.com's API to fetch logs and deployment information. All tools are read-only and require Render API authentication.

## Operations

- render_get_logs: Fetch logs from a Render.com service. Supports time range filtering, text search, and log limits. Useful for investigating deployment issues, errors, and runtime behavior.
- render_list_services: List all Render services. Returns service IDs, names, types, status, and repository information. Useful for discovering service IDs for log queries.
- render_get_deployments: Get recent deployments for a Render service. Returns deployment ID, status, commit info, and timestamps. Useful for correlating incidents with recent deployments.

## Use Cases

- Investigating production errors by fetching relevant logs
- Correlating incidents with recent deployments
- Checking deployment status and history
- Finding which service handles specific functionality
- Debugging runtime issues with log analysis

## Authentication

Requires a Render API key with read access. Credentials can be provided via:
1. Render integration in PrismaLens settings
2. `RENDER_API_KEY` environment variable
3. `RENDER_OWNER_ID` for owner-scoped operations

## Resource IDs

Render uses service IDs (srv-xxx) and resource IDs for log queries. Use `render_list_services` to discover available service IDs.
