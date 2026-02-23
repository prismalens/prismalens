---
name: precedent
description: Search past resolutions and runbooks for proven solutions
allowed-tools: search_similar_resolutions lookup_runbook
metadata:
  requiredIntegrations: runbook confluence
---

# Precedent Investigation Skill

Search for similar past incident resolutions and operational runbooks.

## search_similar_resolutions
Search for similar past incident resolutions to ground fix proposals in proven solutions.
Parameters: query, category (optional, root cause category), limit (optional, default 5)

## lookup_runbook
Look up operational runbooks for a service or incident category.
Parameters: serviceId (optional), category (optional), query (optional)

## Best Practices
- Search by incident title and symptoms first for broad matches
- Filter by root cause category once a hypothesis is forming
- Cross-reference runbook steps with the current environment state
- Past resolutions provide confidence for fix proposals
