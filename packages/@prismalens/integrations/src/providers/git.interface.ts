/**
 * Git Provider Interface
 *
 * Abstraction layer for git hosting services (GitHub, GitLab, BitBucket).
 * Uses an injected authenticated request function (from AuthManager.request)
 * instead of raw access tokens.
 */
import type {
	GitFileContent,
	GitOrganization,
	GitRepository,
} from "@prismalens/config/integrations";
import type { AuthMode } from "../types.js";
import type { AuthenticatedRequestFn } from "./types.js";

/**
 * Context passed to git provider methods for auth-mode-aware behavior.
 */
export interface GitProviderContext {
	authMode?: AuthMode;
}

/**
 * Git Provider interface
 *
 * Each provider (GitHub, GitLab, BitBucket) implements this interface
 * to provide a unified API for interacting with git repositories.
 */
export interface GitProvider {
	readonly name: string;

	getOrganizations(
		request: AuthenticatedRequestFn,
		ctx?: GitProviderContext,
	): Promise<GitOrganization[]>;

	getRepositories(
		request: AuthenticatedRequestFn,
		org?: string,
		ctx?: GitProviderContext,
	): Promise<GitRepository[]>;

	getFileContents(
		request: AuthenticatedRequestFn,
		repo: string,
		path: string,
		ref?: string,
	): Promise<GitFileContent>;

	testConnection(request: AuthenticatedRequestFn): Promise<boolean>;

	getAuthenticatedUser(
		request: AuthenticatedRequestFn,
	): Promise<{ id: string; login: string; name?: string; avatarUrl?: string }>;
}

export type GitProviderFactory = (providerName: string) => GitProvider | null;
