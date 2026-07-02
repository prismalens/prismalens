/**
 * GitHub Provider Implementation
 *
 * Implements the GitProvider interface for GitHub.
 * Uses the injected authenticated request function (from AuthManager.request).
 * Handles both user tokens (PAT/OAuth) and GitHub App installation tokens.
 */
import type {
	GitFileContent,
	GitOrganization,
	GitRepository,
} from "@prismalens/config/integrations";
import type { GitProvider, GitProviderContext } from "../git.interface.js";
import type { AuthenticatedRequestFn } from "../types.js";

// GitHub API response types (snake_case)
interface GitHubOrg {
	id: number;
	login: string;
	avatar_url: string;
	description: string | null;
}

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
	owner: { login: string; id: number; avatar_url: string; type: string };
}

interface GitHubContent {
	path: string;
	content: string;
	encoding: string;
	sha: string;
	size: number;
}

interface GitHubUser {
	id: number;
	login: string;
	name: string | null;
	avatar_url: string;
}

async function json<T>(response: Response): Promise<T> {
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`GitHub API error: ${response.status} - ${errorText}`);
	}
	return response.json() as Promise<T>;
}

/**
 * Parse GitHub's Link header to find the "next" page URL path.
 * Returns the path portion (e.g. "/user/repos?per_page=100&page=2") or null.
 */
function getNextPagePath(response: Response): string | null {
	const link = response.headers.get("link");
	if (!link) return null;
	const match = /<https:\/\/api\.github\.com([^>]+)>;\s*rel="next"/.exec(link);
	return match?.[1] ?? null;
}

/**
 * Paginate a GitHub list endpoint, collecting all results.
 */
async function paginateList<T>(
	request: AuthenticatedRequestFn,
	initialPath: string,
): Promise<T[]> {
	const results: T[] = [];
	let path: string | null = initialPath;

	while (path) {
		const response = await request("GET", path);
		const page = await json<T[]>(response);
		results.push(...page);
		path = getNextPagePath(response);
	}

	return results;
}

/**
 * Paginate the /installation/repositories endpoint which wraps results
 * in { total_count, repositories }.
 */
async function paginateInstallationRepos(
	request: AuthenticatedRequestFn,
	initialPath: string,
): Promise<GitHubRepo[]> {
	const results: GitHubRepo[] = [];
	let path: string | null = initialPath;

	while (path) {
		const response = await request("GET", path);
		const data = await json<{
			total_count: number;
			repositories: GitHubRepo[];
		}>(response);
		results.push(...data.repositories);
		path = getNextPagePath(response);
	}

	return results;
}

function mapRepo(repo: GitHubRepo): GitRepository {
	return {
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
	};
}

export class GitHubProvider implements GitProvider {
	readonly name = "github";

	/**
	 * Get organizations the authenticated user has access to.
	 *
	 * For GitHub App installations: derives orgs from repo owners
	 * (installation tokens cannot call /user/orgs).
	 *
	 * For PAT/OAuth: calls /user/orgs directly.
	 */
	async getOrganizations(
		request: AuthenticatedRequestFn,
		ctx?: GitProviderContext,
	): Promise<GitOrganization[]> {
		if (ctx?.authMode === "github_app") {
			// Installation tokens cannot call /user/orgs — derive from repos
			const repos = await paginateInstallationRepos(
				request,
				"/installation/repositories?per_page=100",
			);
			const ownerMap = new Map<
				string,
				{ id: number; login: string; avatar_url: string; type: string }
			>();
			for (const repo of repos) {
				if (!ownerMap.has(repo.owner.login)) {
					ownerMap.set(repo.owner.login, repo.owner);
				}
			}
			return Array.from(ownerMap.values()).map((owner) => ({
				id: String(owner.id),
				name: owner.login,
				displayName: owner.login,
				avatarUrl: owner.avatar_url,
			}));
		}

		const orgs = await paginateList<GitHubOrg>(
			request,
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
	 * Get repositories from an organization or user's repos.
	 *
	 * For GitHub App installations: uses /installation/repositories.
	 * For PAT/OAuth: uses /orgs/{org}/repos or /user/repos.
	 */
	async getRepositories(
		request: AuthenticatedRequestFn,
		org?: string,
		ctx?: GitProviderContext,
	): Promise<GitRepository[]> {
		if (ctx?.authMode === "github_app") {
			let repos = await paginateInstallationRepos(
				request,
				"/installation/repositories?per_page=100",
			);
			// Filter by org if specified
			if (org) {
				repos = repos.filter(
					(r) => r.owner.login.toLowerCase() === org.toLowerCase(),
				);
			}
			return repos.map(mapRepo);
		}

		const path = org
			? `/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=updated&direction=desc`
			: "/user/repos?per_page=100&sort=updated&direction=desc&affiliation=owner,collaborator,organization_member";

		const repos = await paginateList<GitHubRepo>(request, path);
		return repos.map(mapRepo);
	}

	/**
	 * Get file contents from a repository.
	 */
	async getFileContents(
		request: AuthenticatedRequestFn,
		repo: string,
		path: string,
		ref?: string,
	): Promise<GitFileContent> {
		// repo is "owner/name" — encode each segment; path segments are also encoded
		const encodedRepo = repo.split("/").map(encodeURIComponent).join("/");
		const encodedPath = path.split("/").map(encodeURIComponent).join("/");
		const url = ref
			? `/repos/${encodedRepo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`
			: `/repos/${encodedRepo}/contents/${encodedPath}`;

		const response = await request("GET", url);
		const content = await json<GitHubContent>(response);

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
	 * Test the connection with the provided access token.
	 */
	async testConnection(request: AuthenticatedRequestFn): Promise<boolean> {
		try {
			await this.getAuthenticatedUser(request);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get the authenticated user's information.
	 */
	async getAuthenticatedUser(
		request: AuthenticatedRequestFn,
	): Promise<{ id: string; login: string; name?: string; avatarUrl?: string }> {
		const response = await request("GET", "/user");
		const user = await json<GitHubUser>(response);
		return {
			id: String(user.id),
			login: user.login,
			name: user.name ?? undefined,
			avatarUrl: user.avatar_url,
		};
	}
}
