---
name: code
description: Search code and retrieve file contents from repositories
allowed-tools: search_code get_file_content
metadata:
  requiredIntegrations: github gitlab
---

# Code Investigation Skill

Search code across repositories and retrieve specific file contents.

## search_code
Search code across a repository for relevant patterns, functions, or configurations.
Parameters: query, repo (optional), filePattern (optional, e.g. "*.ts")

## get_file_content
Retrieve the content of a specific file from a repository.
Parameters: path, repo (optional), ref (optional, git ref)

## Best Practices
- Search for error messages found in logs to locate the source code
- Look for recent changes in configuration files
- Check deployment manifests and infrastructure-as-code files
- Use filePattern to narrow search to relevant file types
