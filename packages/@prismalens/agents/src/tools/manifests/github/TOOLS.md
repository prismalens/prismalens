---
name: github-code
category: github
description: Read and search code in GitHub repositories. Provides tools for fetching file contents, searching code patterns, listing directories, and viewing commit history.
readOnly: true
estimatedTokens: 900
keywords: [github, code, files, search, commits, repository, git]
---

# GitHub Code Tools

Tools for reading and searching code in GitHub repositories. All tools are read-only and require GitHub authentication.

## Operations

- github_get_file: Read raw contents of a file from a GitHub repository. Returns the file content as text. Supports specifying branch, tag, or commit SHA.
- github_search_code: Search for code patterns in a GitHub repository. Returns matching file paths. Supports filtering by file extension.
- github_list_directory: List contents of a directory in a GitHub repository. Returns file and folder names with types and sizes.
- github_get_commits: Get recent commits for a repository, optionally filtered by file path or date range. Returns commit SHA, message, author, and date.

## Use Cases

- Finding where errors are thrown in the codebase
- Searching for function definitions and usages
- Understanding code structure and organization
- Correlating incidents with recent code changes
- Finding configuration files and environment setup
- Locating related code across the repository

## Authentication

Requires a GitHub personal access token with `repo` scope. Token can be provided via:
1. GitHub integration in PrismaLens settings
2. `GITHUB_TOKEN` environment variable

## Rate Limits

GitHub API has rate limits. Authenticated requests get 5,000 requests per hour. Use search efficiently by combining filters.
