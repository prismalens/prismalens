// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { inspect } from "node:util";
import type { GitCredentialDisplay } from "@prismalens/contracts/schemas";
import type { GitEnvInput } from "./git-env.js";

export type { GitCredentialDisplay };
export type GitCredentialSource = GitCredentialDisplay["source"];

/**
 * The username each host expects beside a token over HTTPS basic auth (#634):
 * GitLab (gitlab.com and self-managed hosts named gitlab.*) takes `oauth2`,
 * Bitbucket Cloud `x-token-auth`, GitHub and everything else `x-access-token`.
 */
export function tokenUsernameFor(hostname: string): string {
	const host = hostname.toLowerCase();
	if (host === "bitbucket.org") return "x-token-auth";
	if (host === "gitlab.com" || host.split(".").includes("gitlab")) {
		return "oauth2";
	}
	return "x-access-token";
}

/** `ssh://…` or scp-style `user@host:path`; tokens never apply to either. */
export function isSshUrl(url: string): boolean {
	return /^ssh:\/\//i.test(url) || /^[\w.-]+@[\w.-]+:(?!\/\/)/.test(url);
}

/** `host[:port]`, lowercased, of an http(s), ssh or scp-style URL; null when it has none. */
export function urlHost(url: string): string | null {
	try {
		const u = new URL(
			url.replace(/^([\w.-]+)@([^:/]+):(?!\/\/)/, "ssh://$1@$2/"),
		);
		return u.host.toLowerCase() || null;
	} catch {
		return null;
	}
}

/** `owner/repo` of a URL. */
export function repoPath(url: string): string {
	try {
		const u = new URL(
			url.replace(/^([\w.-]+)@([^:/]+):(?!\/\/)/, "ssh://$1@$2/"),
		);
		return u.pathname.replace(/^\/+/, "").replace(/\.git$/, "") || url;
	} catch {
		return url;
	}
}

const HOST_RULE = /^[a-z0-9.-]+(:\d{1,5})?$/;

/** A typed host as `host[:port]`: lowercased, scheme and path dropped; null when it still is not one. */
export function normalizeGitHost(input: string): string | null {
	const host = input
		.trim()
		.toLowerCase()
		.replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
		.replace(/^[^@/]*@/, "")
		.replace(/\/.*$/, "");
	return HOST_RULE.test(host) ? host : null;
}

export const GIT_HOST_RULE =
	"Host must be a hostname with an optional :port, like github.com or git.example.com:8443";

/** The git host a saved GitHub token belongs to: `api.github.com` → `github.com`, `https://h/api/v3` → `h`. */
export function hostFromGithubBaseUrl(baseUrl: unknown): string {
	if (typeof baseUrl !== "string" || !baseUrl.trim()) return "github.com";
	try {
		const host = new URL(baseUrl.trim()).host.toLowerCase();
		return host === "api.github.com" ? "github.com" : host;
	} catch {
		return "github.com";
	}
}

/** The keys a saved credential may keep its token under; `apiKey` is what 0.5.0 GitHub token rows store. */
export const TOKEN_KEYS = [
	"token",
	"accessToken",
	"access_token",
	"personalAccessToken",
	"apiKey",
] as const;

export function tokenFrom(creds: Record<string, unknown>): string | null {
	for (const key of TOKEN_KEYS) {
		const value = creds[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

/** The short helper name for a label, or null when the first word is quoted or escaped. */
export function helperName(value: string): string | null {
	const m = /^!?([A-Za-z0-9_./-]+)(\s|$)/.exec(value.trim());
	if (!m?.[1]) return null;
	return m[1].split("/").pop() || null;
}

/**
 * Who git authenticates as for one repository. The token is a #private field, so
 * spread, structuredClone, JSON and util.inspect all see `display` and nothing else (#673).
 */
export class GitCredential {
	readonly display: GitCredentialDisplay;
	/** The URL git will contact after `insteadOf`; the header is scoped to its host. */
	readonly effectiveUrl?: string;
	#token?: string;
	#host?: string;

	constructor(
		display: GitCredentialDisplay,
		token?: string,
		opts: { effectiveUrl?: string; host?: string } = {},
	) {
		this.display = display;
		if (opts.effectiveUrl) this.effectiveUrl = opts.effectiveUrl;
		this.#token = token;
		this.#host = opts.host;
	}

	/** `Authorization: Basic …` for an https URL on the token's own host, else undefined. */
	authHeader(effectiveUrl: string): string | undefined {
		if (this.display.source !== "connection" || !this.#token) return undefined;
		if (!/^https:\/\//i.test(effectiveUrl)) return undefined;
		const url = new URL(effectiveUrl);
		if (this.#host && url.host.toLowerCase() !== this.#host) return undefined;
		const user = tokenUsernameFor(url.hostname);
		return `Authorization: Basic ${Buffer.from(`${user}:${this.#token}`).toString("base64")}`;
	}

	/** What `gitEnv` needs for a call to `url`. */
	envInput(url: string): Pick<GitEnvInput, "source" | "authHeader" | "scope"> {
		const target = this.effectiveUrl ?? url;
		const authHeader = this.authHeader(target);
		if (this.display.source === "connection" && authHeader) {
			const u = new URL(target);
			return {
				source: "connection",
				authHeader,
				scope: `${u.protocol}//${u.host}`,
			};
		}
		return {
			source:
				this.display.source === "connection" ? "none" : this.display.source,
		};
	}

	/** Two calls with the same key may share one mirror fetch. */
	get key(): string {
		return `${this.display.source}:${this.display.connectionId ?? ""}|${this.display.via}`;
	}

	toJSON(): GitCredentialDisplay {
		return this.display;
	}

	[inspect.custom](): GitCredentialDisplay {
		return this.display;
	}
}

export const MACHINE_CREDENTIAL = new GitCredential({
	source: "machine",
	label: "machine git",
	via: "git",
});
