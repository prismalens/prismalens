---
name: code-search
description: Searches the codebase for error origins, patterns, and relevant code sections to understand the context of an incident.
capability: code-search
integrations:
  - github
  - gitlab
  - bitbucket
  - repo
---

# Code Search Skill

## Purpose
Search the connected repository to find error origins, related code patterns, and contextual information needed for incident investigation.

## Capability-Based Tools
This skill uses the **code-search** capability which automatically resolves to the appropriate integration:

| Integration | Tools Available |
|-------------|-----------------|
| GitHub | `github_search_code`, `github_get_file`, `github_list_files` |
| GitLab | `gitlab_search_code`, `gitlab_get_file`, `gitlab_list_files` |
| Bitbucket | `bitbucket_search`, `bitbucket_get_file` |
| Local Repo | `repo_search`, `repo_read_file`, `repo_list_dir` |

The system automatically selects tools based on the configured integration. You don't need to choose which one to use - just describe what you need.

## Process

### 1. Error Message Search
When given an error message:
- Extract unique identifiable parts (not variable names)
- Search for exact string matches first
- Expand to partial matches if needed

### 2. Stack Trace Analysis
When given a stack trace:
- Identify file paths and line numbers
- Read the relevant code sections
- Check for error handling patterns

### 3. Contextual Exploration
Once error origin is found:
- Read surrounding functions
- Check imports and dependencies
- Look for related error handlers
- Find configuration references

### 4. Change Detection
- Check if affected files have recent changes
- Look for TODOs or FIXMEs nearby
- Identify test coverage

## Output Format

Return findings as structured summary:

```json
{
  "errorOrigin": {
    "file": "src/api/handler.ts",
    "line": 142,
    "function": "processRequest",
    "codeSnippet": "if (!user) throw new Error('User not found')"
  },
  "relatedFiles": [
    {
      "path": "src/api/middleware.ts",
      "relevance": "Calls processRequest",
      "lines": "25-30"
    }
  ],
  "dependencies": [
    {
      "name": "some-package",
      "version": "2.1.0",
      "usage": "Used in error handling"
    }
  ],
  "configReferences": [
    {
      "path": ".env.example",
      "variable": "API_TIMEOUT",
      "currentValue": "30000"
    }
  ],
  "recentChanges": [
    {
      "commit": "abc123",
      "date": "2024-01-15",
      "message": "Refactored user lookup"
    }
  ],
  "confidence": 90
}
```

## Best Practices

1. **Specific Queries**: Use exact error strings before generalizing
2. **Follow the Stack**: Trace execution path from error to origin
3. **Check Tests**: Test files often document expected behavior
4. **Note Context**: Include enough surrounding code for understanding
5. **Efficient Reads**: Read specific line ranges, not entire large files
