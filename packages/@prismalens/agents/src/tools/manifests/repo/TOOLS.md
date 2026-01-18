---
name: repo-files
category: repo
description: Read and search files in the local repository. Provides tools for reading file contents, listing directories, searching for text patterns, and getting file metadata.
readOnly: true
estimatedTokens: 850
keywords: [local, repository, files, search, filesystem, code]
---

# Local Repository Tools

Tools for interacting with local repository files. All operations are sandboxed to the configured base path for security. Tools are read-only.

## Operations

- repo_read_file: Read contents of a file from the local repository. Returns the file content as text. Large files are truncated to prevent context overflow.
- repo_list_directory: List contents of a directory in the local repository. Returns file and folder information. Supports recursive listing up to 3 levels. Excludes hidden files and common ignore patterns (node_modules, dist, etc.).
- repo_search_text: Search for text patterns in repository files. Returns matching lines with file paths and line numbers. Supports file extension filtering. Limited to 50 results.
- repo_get_file_info: Get metadata about a file or directory. Returns size, type, creation date, modification date, and access date.

## Use Cases

- Reading source code files for analysis
- Finding where specific errors or patterns occur
- Understanding project structure
- Locating configuration and environment files
- Searching for function definitions and usages

## Security

All file operations are sandboxed to the configured base path. Paths outside this directory are rejected. The base path can be configured via:
1. Repo integration in PrismaLens settings
2. `REPO_BASE_PATH` environment variable
3. Defaults to current working directory

## File Size Limits

Files larger than 50,000 characters are truncated. Search results are limited to 50 matches. Directory listing excludes common non-source directories.
