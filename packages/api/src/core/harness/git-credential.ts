// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isAbsolute } from "node:path";
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

export const UNSHOWN_REPO = "a repository PrismaLens cannot show";

const SAFE_REPO = /^[\w.~+-]+(?:\/[\w.~+-]+)*$/;

/** `owner/repo` of a URL; anything else, such as a path that holds a URL, is never echoed (#848). */
export function repoPath(url: string): string {
	try {
		const u = new URL(
			url.replace(/^([\w.-]+)@([^:/]+):(?!\/\/)/, "ssh://$1@$2/"),
		);
		const path = u.pathname.replace(/^\/+/, "").replace(/\.git$/, "");
		return SAFE_REPO.test(path) ? path : UNSHOWN_REPO;
	} catch {
		return UNSHOWN_REPO;
	}
}

const SCHEME_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
const SCP_REMOTE = /^[\w.-]+@[\w.-]+:(?!\/\/)/;
const SSH_SCHEME = /^(?:ssh|git\+ssh|ssh\+git):$/i;
/** A path holding another address, such as `host/https://u:pw@other/x`, is never echoed; `api@2.git` is a path. */
function nested(path: string): boolean {
	let decoded: string;
	try {
		decoded = decodeURIComponent(path);
	} catch {
		return true;
	}
	return (
		decoded.includes("://") ||
		/%40/i.test(path) ||
		decoded.split("/").some((s) => s.includes("@") && s.includes(":"))
	);
}

/** A stored address as it may be shown: rows saved before #934 can hold userinfo or a query, so a URL keeps only an ssh username and an scp remote loses its query (#938). */
export function shownRepoUrl(sourceKind: string, url: string): string {
	if (sourceKind === "folder") return url;
	if (SCP_REMOTE.test(url)) {
		const shown = url.split("?")[0] as string;
		return nested(shown.slice(shown.indexOf(":") + 1)) ? UNSHOWN_REPO : shown;
	}
	if (!SCHEME_URL.test(url)) return UNSHOWN_REPO;
	try {
		const u = new URL(url);
		if (!u.host || nested(u.pathname)) return UNSHOWN_REPO;
		const user = SSH_SCHEME.test(u.protocol) ? u.username : "";
		if (!u.password && !u.search && !u.hash && u.username === user) return url;
		u.password = u.search = u.hash = "";
		u.username = user;
		return u.href;
	} catch {
		return UNSHOWN_REPO;
	}
}

const fold = (s: string) => s.replace(/[^A-Za-z0-9]/g, "_");

/** Whether `text`, such as a run's folder name, holds a part `shownRepoUrl` removes from `raw`, kept as is or folded to `_` (#938). */
export function holdsRemoved(raw: string, text: string): boolean {
	const pieces: string[] = [];
	if (SCP_REMOTE.test(raw)) pieces.push(raw.split("?").slice(1).join("?"));
	else {
		try {
			const u = new URL(raw);
			if (!SSH_SCHEME.test(u.protocol)) pieces.push(u.username);
			pieces.push(u.password, u.search.slice(1), u.hash.slice(1));
			for (const v of u.searchParams.values()) pieces.push(v);
		} catch {
			return false;
		}
	}
	const folded = fold(text);
	return pieces.some((p) => p.length >= 4 && folded.includes(fold(p)));
}

/** A stored repository name: one a legacy address was named by may be that address (#938). */
export function shownRepoName(sourceKind: string, name: string): string {
	if (sourceKind === "folder") return name;
	if (SCHEME_URL.test(name) || SCP_REMOTE.test(name))
		return shownRepoUrl("url", name);
	return nested(name) || name.includes("?") ? UNSHOWN_REPO : name;
}

/** One whitespace-separated word of a note, its address shown; `(` and `).,;` around it are kept. */
function shownWord(word: string): string {
	let start = 0;
	let end = word.length;
	if (word[0] === "(") start = 1;
	while (end > start && ").,;".includes(word[end - 1] as string)) end--;
	const core = word.slice(start, end);
	if (!core.includes("://") && !SCP_REMOTE.test(core)) return word;
	const shown = shownRepoUrl("url", core);
	return shown === core
		? word
		: `${word.slice(0, start)}${shown}${word.slice(end)}`;
}

/** Free text written before #938 from a stored address, each address in it shown as shownRepoUrl shows it; a folder path is left as written. */
export function shownText(text: string): string {
	const unspaced = text.replace(/:\/\/[^/@\s]*(?:\s[^/@\s]*)+@/g, "://");
	return unspaced.split(/(\s+)/).map(shownWord).join("");
}

/** shownRepoUrl for a recorded address whose kind was not kept: an absolute path is a folder. */
export function shownAddress(address: string): string {
	return shownRepoUrl(isAbsolute(address) ? "folder" : "url", address);
}

/** A repository for a log line: `host/owner/repo` for a URL, the path for a folder; never userinfo, query or fragment (#848). */
export function repoLabel(source: string): string {
	const host = urlHost(source);
	if (host) return `${host}/${repoPath(source)}`;
	return isAbsolute(source) ? source : UNSHOWN_REPO;
}

const HOST_RULE = /^[a-z0-9.-]+(:\d{1,5})?$/;

/**
 * A typed host as `host[:port]`, the way `urlHost` reads a URL: lowercased, scheme and path
 * dropped, the scheme's default port (:443, :80 for http) dropped; null when it is not one (#848).
 */
export function normalizeGitHost(input: string): string | null {
	const text = input.trim().toLowerCase();
	const host = text
		.replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
		.replace(/^[^@/]*@/, "")
		.replace(/\/.*$/, "");
	if (!HOST_RULE.test(host)) return null;
	const [name = "", port] = host.split(":");
	if (port === undefined) return host;
	const n = Number(port);
	return n === (text.startsWith("http://") ? 80 : 443) ? name : `${name}:${n}`;
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

/** An environment token for a git host, read the way gh and glab read it. */
export interface EnvGitToken {
	variable: string;
	token: string;
}

/**
 * The env token for `host` (#848): github.com takes GH_TOKEN then GITHUB_TOKEN, the host
 * named by GH_HOST the enterprise pair, gitlab.com or GITLAB_HOST GITLAB_TOKEN; Bitbucket none.
 */
export function envTokenFor(
	host: string,
	env: NodeJS.ProcessEnv = process.env,
): EnvGitToken | null {
	const first = (...names: string[]): EnvGitToken | null => {
		for (const variable of names) {
			const token = env[variable]?.trim();
			if (token) return { variable, token };
		}
		return null;
	};
	const h = host.toLowerCase();
	if (h === "github.com") return first("GH_TOKEN", "GITHUB_TOKEN");
	if (env.GH_HOST && normalizeGitHost(env.GH_HOST) === h)
		return first("GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN");
	if (
		h === "gitlab.com" ||
		(env.GITLAB_HOST && normalizeGitHost(env.GITLAB_HOST) === h)
	)
		return first("GITLAB_TOKEN");
	return null;
}

/** A token-bearing source: a saved connection or an env token. */
export function isTokenSource(source: GitCredentialSource): boolean {
	return source === "connection" || source === "env";
}

/** The short helper name for a label, or null when the first word is quoted or escaped. */
export function helperName(value: string): string | null {
	const m = /^!?([A-Za-z0-9_./-]+)(\s|$)/.exec(value.trim());
	if (!m?.[1]) return null;
	return m[1].split("/").pop() || null;
}

/** What a response may say of a helper: its name, never its text, which can embed a token (#848). */
export function helperLabel(value: string): string {
	return helperName(value) ?? "a custom git credential helper";
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
		if (!isTokenSource(this.display.source) || !this.#token) return undefined;
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
		if (isTokenSource(this.display.source) && authHeader) {
			const u = new URL(target);
			return {
				source: "connection",
				authHeader,
				scope: `${u.protocol}//${u.host}`,
			};
		}
		return {
			source: this.display.source === "machine" ? "machine" : "none",
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
