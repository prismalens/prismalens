import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import axios from 'axios';
import type { StructuredTool } from '@langchain/core/tools';
import type { ToolFactoryOptions } from './factory.js';

// =============================================================================
// GITHUB TOOLS
// =============================================================================
// Tools for interacting with GitHub API.
// Supports both environment-based and integration-based credentials.
// =============================================================================

/**
 * Get GitHub token from integrations or environment
 */
function getGitHubToken(integrations: ToolFactoryOptions['integrations']): string | undefined {
    // Check integrations first
    const githubIntegration = integrations.find(
        (i) => i.type.toLowerCase() === 'github'
    );
    if (githubIntegration?.credentials?.accessToken) {
        return githubIntegration.credentials.accessToken as string;
    }

    // Fall back to environment variable
    return process.env.GITHUB_TOKEN;
}

/**
 * Create GitHub API tools for an agent.
 */
export function createGitHubTools(options: ToolFactoryOptions): StructuredTool[] {
    const token = getGitHubToken(options.integrations);

    const tools: StructuredTool[] = [
        // Get file contents from a repository
        tool(
            async ({ owner, repo, path, ref }) => {
                try {
                    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
                    const params: Record<string, string> = {};
                    if (ref) params.ref = ref;

                    const response = await axios.get(url, {
                        headers: {
                            Accept: 'application/vnd.github.v3.raw',
                            Authorization: token ? `Bearer ${token}` : undefined,
                        },
                        params,
                    });

                    return response.data;
                } catch (error: any) {
                    if (error.response?.status === 404) {
                        return `File not found: ${path}`;
                    }
                    return `Error fetching file: ${error.message}`;
                }
            },
            {
                name: 'github_get_file',
                description:
                    'Get raw contents of a file from a GitHub repository. Returns the file content as text.',
                schema: z.object({
                    owner: z.string().describe('Repository owner (user or organization)'),
                    repo: z.string().describe('Repository name'),
                    path: z.string().describe('File path within the repository'),
                    ref: z
                        .string()
                        .optional()
                        .describe('Branch, tag, or commit SHA (defaults to main branch)'),
                }),
            }
        ),

        // Search code in a repository
        tool(
            async ({ owner, repo, query, extension }) => {
                try {
                    let q = `${query} repo:${owner}/${repo}`;
                    if (extension) {
                        q += ` extension:${extension}`;
                    }

                    const response = await axios.get(
                        'https://api.github.com/search/code',
                        {
                            headers: {
                                Authorization: token ? `Bearer ${token}` : undefined,
                            },
                            params: { q },
                        }
                    );

                    const items = response.data.items.slice(0, 10).map((item: any) => ({
                        path: item.path,
                        name: item.name,
                        htmlUrl: item.html_url,
                    }));

                    return JSON.stringify(items, null, 2);
                } catch (error: any) {
                    return `Error searching code: ${error.message}`;
                }
            },
            {
                name: 'github_search_code',
                description:
                    'Search for code in a GitHub repository. Returns matching file paths.',
                schema: z.object({
                    owner: z.string().describe('Repository owner'),
                    repo: z.string().describe('Repository name'),
                    query: z.string().describe('Search query (code pattern to find)'),
                    extension: z
                        .string()
                        .optional()
                        .describe('File extension filter (e.g., "ts", "py")'),
                }),
            }
        ),

        // List directory contents
        tool(
            async ({ owner, repo, path, ref }) => {
                try {
                    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path || ''}`;
                    const params: Record<string, string> = {};
                    if (ref) params.ref = ref;

                    const response = await axios.get(url, {
                        headers: {
                            Authorization: token ? `Bearer ${token}` : undefined,
                        },
                        params,
                    });

                    if (!Array.isArray(response.data)) {
                        return 'Path is a file, not a directory. Use github_get_file instead.';
                    }

                    const items = response.data.map((item: any) => ({
                        name: item.name,
                        type: item.type,
                        path: item.path,
                        size: item.size,
                    }));

                    return JSON.stringify(items, null, 2);
                } catch (error: any) {
                    if (error.response?.status === 404) {
                        return `Directory not found: ${path}`;
                    }
                    return `Error listing directory: ${error.message}`;
                }
            },
            {
                name: 'github_list_directory',
                description:
                    'List contents of a directory in a GitHub repository. Returns file and folder names.',
                schema: z.object({
                    owner: z.string().describe('Repository owner'),
                    repo: z.string().describe('Repository name'),
                    path: z
                        .string()
                        .optional()
                        .describe('Directory path (empty for root)'),
                    ref: z
                        .string()
                        .optional()
                        .describe('Branch, tag, or commit SHA'),
                }),
            }
        ),

        // Get recent commits
        tool(
            async ({ owner, repo, path, since, per_page }) => {
                try {
                    const params: Record<string, any> = {
                        per_page: per_page || 10,
                    };
                    if (path) params.path = path;
                    if (since) params.since = since;

                    const response = await axios.get(
                        `https://api.github.com/repos/${owner}/${repo}/commits`,
                        {
                            headers: {
                                Authorization: token ? `Bearer ${token}` : undefined,
                            },
                            params,
                        }
                    );

                    const commits = response.data.map((commit: any) => ({
                        sha: commit.sha.substring(0, 7),
                        message: commit.commit.message.split('\n')[0],
                        author: commit.commit.author.name,
                        date: commit.commit.author.date,
                    }));

                    return JSON.stringify(commits, null, 2);
                } catch (error: any) {
                    return `Error fetching commits: ${error.message}`;
                }
            },
            {
                name: 'github_get_commits',
                description:
                    'Get recent commits for a repository, optionally filtered by file path.',
                schema: z.object({
                    owner: z.string().describe('Repository owner'),
                    repo: z.string().describe('Repository name'),
                    path: z
                        .string()
                        .optional()
                        .describe('Filter commits by file path'),
                    since: z
                        .string()
                        .optional()
                        .describe('ISO 8601 date - only commits after this date'),
                    per_page: z
                        .number()
                        .optional()
                        .default(10)
                        .describe('Number of commits to return (max 100)'),
                }),
            }
        ),
    ];

    return tools;
}

// Legacy export for backward compatibility
export const githubTools = createGitHubTools({
    agentName: 'default',
    integrations: [],
});
