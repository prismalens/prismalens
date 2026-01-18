/**
 * GitHub Provider Implementation
 *
 * Implements the GitProvider interface for GitHub.
 * Uses the GitHub REST API v3.
 */

import { Logger } from "@nestjs/common";
import type {
	GitFileContent,
	GitOrganization,
	GitProvider,
	GitRepository,
} from "./git-provider.interface.js";

const GITHUB_API_BASE = "https://api.github.com";

export class GitHubProvider implements GitProvider {
	readonly name = "github";
	private readonly logger = new Logger(GitHubProvider.name);

	/**
	 * Make an authenticated request to GitHub API
	 */
	private async request<T>(
		accessToken: string,
		path: string,
		options: RequestInit = {},
	): Promise<T> {
		const url = path.startsWith("http") ? path : `${GITHUB_API_BASE}${path}`;

		const response = await fetch(url, {
			...options,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/vnd.github.v3+json",
				"User-Agent": "PrismaLens",
				...options.headers,
			},
		});

		if (!response.ok) {
			const errorText = await response.text();
			this.logger.error(`GitHub API error: ${response.status} - ${errorText}`);
			throw new Error(`GitHub API error: ${response.status}`);
		}

		return response.json() as Promise<T>;
	}

	/**
	 * Get organizations the authenticated user has access to
	 */
	async getOrganizations(accessToken: string): Promise<GitOrganization[]> {
		interface GitHubOrg {
			id: number;
			login: string;
			avatar_url: string;
			description: string | null;
		}

		// Get user's organizations
		const orgs = await this.request<GitHubOrg[]>(
			accessToken,
			"/user/orgs?per_page=100",
		);

		return orgs.map((org) => ({
			id: String(org.id),
			name: org.login,
			displayName: org.login,
			avatarUrl: org.avatar_url,
			description: org.description ?? undefined,
		}));
	}

	/**
	 * Get repositories from an organization or user's repos
	 */
	async getRepositories(
		accessToken: string,
		org?: string,
	): Promise<GitRepository[]> {
		interface GitHubRepo {
			id: number;
			name: string;
			full_name: string;
			description: string | null;
			language: string | null;
			stargazers_count: number;
			default_branch: string;
			private: boolean;
			html_url: string;
			clone_url: string;
			updated_at: string;
		}

		let repos: GitHubRepo[];

		if (org) {
			// Get repos from a specific organization
			repos = await this.request<GitHubRepo[]>(
				accessToken,
				`/orgs/${org}/repos?per_page=100&sort=updated&direction=desc`,
			);
		} else {
			// Get user's accessible repositories
			repos = await this.request<GitHubRepo[]>(
				accessToken,
				"/user/repos?per_page=100&sort=updated&direction=desc&affiliation=owner,collaborator,organization_member",
			);
		}

		return repos.map((repo) => ({
			id: String(repo.id),
			name: repo.name,
			fullName: repo.full_name,
			description: repo.description ?? undefined,
			language: repo.language ?? undefined,
			stars: repo.stargazers_count,
			defaultBranch: repo.default_branch,
			isPrivate: repo.private,
			url: repo.html_url,
			cloneUrl: repo.clone_url,
			updatedAt: repo.updated_at,
		}));
	}

	/**
	 * Get file contents from a repository
	 */
	async getFileContents(
		accessToken: string,
		repo: string,
		path: string,
		ref?: string,
	): Promise<GitFileContent> {
		interface GitHubContent {
			path: string;
			content: string;
			encoding: string;
			sha: string;
			size: number;
		}

		const url = ref
			? `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`
			: `/repos/${repo}/contents/${path}`;

		const content = await this.request<GitHubContent>(accessToken, url);

		// GitHub returns base64 encoded content
		let decodedContent = content.content;
		if (content.encoding === "base64") {
			decodedContent = Buffer.from(content.content, "base64").toString("utf-8");
		}

		return {
			path: content.path,
			content: decodedContent,
			encoding: "utf-8",
			sha: content.sha,
			size: content.size,
		};
	}

	/**
	 * Test the connection with the provided access token
	 */
	async testConnection(accessToken: string): Promise<boolean> {
		try {
			await this.getAuthenticatedUser(accessToken);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get the authenticated user's information
	 */
	async getAuthenticatedUser(accessToken: string): Promise<{
		id: string;
		login: string;
		name?: string;
		avatarUrl?: string;
	}> {
		interface GitHubUser {
			id: number;
			login: string;
			name: string | null;
			avatar_url: string;
		}

		const user = await this.request<GitHubUser>(accessToken, "/user");

		return {
			id: String(user.id),
			login: user.login,
			name: user.name ?? undefined,
			avatarUrl: user.avatar_url,
		};
	}
}
