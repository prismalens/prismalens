/**
 * Git Provider Interface
 *
 * Abstraction layer for git hosting services (GitHub, GitLab, BitBucket).
 * Implementations handle provider-specific API calls while exposing a
 * unified interface for the rest of the application.
 */

/**
 * Organization/group from a git provider
 */
export interface GitOrganization {
	id: string;
	name: string; // Login/slug (e.g., "prismalens-org")
	displayName: string; // Display name
	avatarUrl?: string;
	repoCount?: number;
	description?: string;
}

/**
 * Repository from a git provider
 */
export interface GitRepository {
	id: string;
	name: string; // Repo name only (e.g., "api")
	fullName: string; // Full name with org (e.g., "prismalens-org/api")
	description?: string;
	language?: string;
	stars?: number;
	defaultBranch: string;
	isPrivate: boolean;
	url: string; // Web URL
	cloneUrl?: string; // HTTPS clone URL
	updatedAt?: string;
}

/**
 * File contents from a git provider
 */
export interface GitFileContent {
	path: string;
	content: string;
	encoding: "utf-8" | "base64";
	sha?: string;
	size: number;
}

/**
 * Git Provider interface
 *
 * Each provider (GitHub, GitLab, BitBucket) implements this interface
 * to provide a unified API for interacting with git repositories.
 */
export interface GitProvider {
	/**
	 * Provider name (e.g., "github", "gitlab", "bitbucket")
	 */
	readonly name: string;

	/**
	 * Get organizations/groups the authenticated user has access to.
	 * For GitHub: Returns organizations where user is a member.
	 * For GitLab: Returns groups where user has access.
	 */
	getOrganizations(accessToken: string): Promise<GitOrganization[]>;

	/**
	 * Get repositories from an organization or all accessible repos.
	 * @param accessToken OAuth access token
	 * @param org Organization/group name (optional - if not provided, returns user's repos)
	 */
	getRepositories(
		accessToken: string,
		org?: string,
	): Promise<GitRepository[]>;

	/**
	 * Get file contents from a repository.
	 * @param accessToken OAuth access token
	 * @param repo Full repo name (e.g., "org/repo")
	 * @param path File path within the repository
	 * @param ref Git ref (branch, tag, or commit SHA) - defaults to default branch
	 */
	getFileContents(
		accessToken: string,
		repo: string,
		path: string,
		ref?: string,
	): Promise<GitFileContent>;

	/**
	 * Test the connection with the provided access token.
	 * Returns true if the token is valid and has required scopes.
	 */
	testConnection(accessToken: string): Promise<boolean>;

	/**
	 * Get the authenticated user's information.
	 */
	getAuthenticatedUser(
		accessToken: string,
	): Promise<{ id: string; login: string; name?: string; avatarUrl?: string }>;
}

/**
 * Factory type for creating git providers
 */
export type GitProviderFactory = (providerName: string) => GitProvider | null;
