// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Git Provider Interface
 *
 * Abstraction layer for git hosting services (GitHub, etc.).
 * Uses an injected authenticated request function (from the api's template-request)
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

/** A change on the default branch, in the row shape `readHistory` gives for a clone (#848). */
export interface GitCommit {
	sha: string;
	parents: number;
	committedAt: Date;
	author: string;
	subject: string;
	body: string;
	tag: string | null;
	files: string[];
}

/**
 * Git Provider interface
 *
 * Each VCS provider segment implements this interface
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

	/** First-parent commits since a time, newest first, without files. Read-only. */
	getCommitsSince?(
		request: AuthenticatedRequestFn,
		repo: string,
		since: Date,
		opts?: { branch?: string; max?: number },
	): Promise<Omit<GitCommit, "files">[]>;

	/** One commit with the paths it touched. Read-only. */
	getCommit?(
		request: AuthenticatedRequestFn,
		repo: string,
		sha: string,
	): Promise<GitCommit>;
}
