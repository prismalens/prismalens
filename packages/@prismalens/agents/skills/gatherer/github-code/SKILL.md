---
name: github-code
description: Search code, commits, and pull requests via GitHub API using http_request
metadata:
  requiredIntegrations: github
---

# GitHub Code & Commits

Search code, review recent commits, and check CI status via GitHub API.

## Quick Reference

Use `http_request` with `integration: "github"`:

### List recent commits
```
http_request({
  integration: "github",
  method: "GET",
  path: "/repos/{owner}/{repo}/commits",
  pathParams: { owner: "<org>", repo: "<repo>" },
  queryParams: { since: "<ISO_date>", per_page: "50" }
})
```

### Search code
```
http_request({
  integration: "github",
  method: "GET",
  path: "/search/code",
  queryParams: { q: "error_string+repo:org/repo+language:typescript" }
})
```

### Get file content
```
http_request({
  integration: "github",
  method: "GET",
  path: "/repos/{owner}/{repo}/contents/{path}",
  pathParams: { owner: "<org>", repo: "<repo>", path: "src/index.ts" }
})
```

### Compare branches/commits
```
http_request({
  integration: "github",
  method: "GET",
  path: "/repos/{owner}/{repo}/compare/{basehead}",
  pathParams: { owner: "<org>", repo: "<repo>", basehead: "main...feature" }
})
```

## Methodology

1. **Recent commits**: List commits since incident start time — identify code changes
2. **Search code**: Search for error strings, affected function names, config keys
3. **Diff analysis**: Compare the last known good state to current — what changed?
4. **CI status**: Check recent workflow runs for test failures or deployment issues

## API Reference

See `/workspace/specs/github-openapi.json` for full endpoint documentation.
Use `grep` to search the spec for specific endpoints.

## Script Templates

Reference scripts in `scripts/` for common operations.
Use `ls` then `read_file` to find relevant templates, adapt for the current investigation.
