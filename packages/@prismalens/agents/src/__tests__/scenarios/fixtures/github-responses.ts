/**
 * GitHub API response fixture builders.
 *
 * Matches the actual GitHub REST API response shapes referenced in
 * skills/gatherer/github-code/SKILL.md.
 */

// =============================================================================
// Commits
// =============================================================================

interface CommitInput {
  sha: string
  message: string
  author: string
  date?: string
  htmlUrl?: string
}

export function buildCommitsResponse(commits: CommitInput[]) {
  return commits.map((c) => ({
    sha: c.sha,
    commit: {
      message: c.message,
      author: {
        name: c.author,
        date: c.date ?? "2025-01-15T09:30:00Z",
      },
    },
    html_url:
      c.htmlUrl ?? `https://github.com/example/repo/commit/${c.sha}`,
  }))
}

// =============================================================================
// Code Search
// =============================================================================

interface CodeSearchInput {
  name: string
  path: string
  repository?: string
  textMatches?: string[]
}

export function buildCodeSearchResponse(results: CodeSearchInput[]) {
  return {
    total_count: results.length,
    items: results.map((r) => ({
      name: r.name,
      path: r.path,
      repository: {
        full_name: r.repository ?? "example/repo",
      },
      text_matches: (r.textMatches ?? []).map((tm) => ({
        fragment: tm,
        object_type: "FileContent",
      })),
    })),
  }
}

// =============================================================================
// File Content
// =============================================================================

export function buildFileContentResponse(path: string, content: string) {
  const name = path.split("/").pop() ?? path
  return {
    name,
    path,
    content: Buffer.from(content).toString("base64"),
    encoding: "base64",
    size: content.length,
    type: "file",
  }
}
