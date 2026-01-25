---
name: recent-commits
description: Retrieves and analyzes recent git commits to identify changes that may have caused the incident.
capability: code-search
integrations:
  - github
  - gitlab
  - bitbucket
  - repo
---

# Recent Commits Skill

## Purpose
Analyze recent git commits to identify code changes that correlate with the incident timing or affect the relevant code paths.

## Capability-Based Tools
This skill uses the **code-search** capability which automatically resolves to the appropriate integration:

| Integration | Tools Available |
|-------------|-----------------|
| GitHub | `github_list_commits`, `github_get_commit` |
| GitLab | `gitlab_list_commits`, `gitlab_get_commit` |
| Bitbucket | `bitbucket_list_commits`, `bitbucket_get_commit` |
| Local Repo | `repo_git_log`, `repo_git_show` |

The system automatically selects tools based on the configured integration. You don't need to choose which one to use - just describe what you need.

## Process

### 1. Determine Time Window
- Start from incident time minus 24-48 hours
- Extend if needed based on deployment frequency

### 2. List Recent Commits
- Get commits in the time window
- Note authors and commit messages
- Identify merge commits vs. direct commits

### 3. Analyze Relevant Changes
For commits touching suspicious files:
- Review the actual diff
- Understand the intent of the change
- Check for obvious issues

### 4. Identify Risky Patterns
Look for:
- Changes to error handling
- Configuration modifications
- Dependency updates
- Authentication/authorization changes

## Output Format

Return findings as structured summary:

```json
{
  "timeWindow": {
    "start": "ISO timestamp",
    "end": "ISO timestamp",
    "totalCommits": 15
  },
  "relevantCommits": [
    {
      "sha": "abc123def",
      "shortSha": "abc123d",
      "message": "Fix user authentication flow",
      "author": "developer@example.com",
      "date": "ISO timestamp",
      "filesChanged": ["src/auth/handler.ts", "src/middleware/auth.ts"],
      "additions": 45,
      "deletions": 12,
      "relevanceReason": "Modified auth code mentioned in error"
    }
  ],
  "suspiciousChanges": [
    {
      "commit": "abc123d",
      "file": "src/auth/handler.ts",
      "change": "Removed null check on user object",
      "risk": "Could cause null pointer if user not found"
    }
  ],
  "dependencyChanges": [
    {
      "commit": "def456",
      "package": "auth-library",
      "from": "1.2.0",
      "to": "1.3.0",
      "breaking": false
    }
  ],
  "revertCandidates": [
    {
      "commit": "abc123d",
      "reason": "Most likely cause based on timing and changed files"
    }
  ],
  "confidence": 75
}
```

## Best Practices

1. **Focus on Affected Paths**: Prioritize commits touching error-related files
2. **Check Merge Commits**: May contain multiple changes
3. **Author Context**: Same author may have related commits
4. **Dependency Updates**: Can introduce subtle breaking changes
5. **Revert History**: Check if the commit was already reverted
