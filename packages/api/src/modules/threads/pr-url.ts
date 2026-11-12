// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PrHost } from "@prismalens/contracts";
import { repoPath, urlHost } from "../../core/harness/git-credential.js";
import { CODE_HOSTS, codeHost } from "./code-hosts/registry.js";

/** A pull request URL as written; nothing about it is trusted yet. */
export interface PrUrl {
	/** The URL rebuilt from its parts, so stored and compared URLs agree. */
	url: string;
	host: string;
	/** `owner/repo`, or a GitLab project path with its groups. */
	repo: string;
	number: number;
	shape: PrHost;
}

const SEGMENT = /^[\w.~-]+$/;
const MAX_NUMBER = 2 ** 31 - 1;

/** Parses each registered host's change-request URL, and a link-only `pull-requests` one; null for anything else. */
export function parsePrUrl(raw: string): PrUrl | null {
	let u: URL;
	try {
		u = new URL(raw.trim());
	} catch {
		return null;
	}
	if (u.protocol !== "https:" || u.username || u.password) return null;
	const host = u.host.toLowerCase();
	const parts = u.pathname.split("/").filter(Boolean);
	const at = (
		shape: PrHost,
		repoParts: string[],
		n: string | undefined,
		tail: (n: number) => string,
	) => {
		const number = Number(n);
		if (!Number.isInteger(number) || number < 1 || number > MAX_NUMBER)
			return null;
		if (!repoParts.length || !repoParts.every((p) => SEGMENT.test(p)))
			return null;
		const repo = repoParts.join("/");
		return {
			url: `https://${host}/${repo}/${tail(number)}`,
			host,
			repo,
			number,
			shape,
		};
	};
	for (const adapter of Object.values(CODE_HOSTS)) {
		const m = adapter.parsePath(parts);
		if (m) return at(adapter.kind, m.repoParts, m.number, adapter.webPath);
	}
	if (parts.length >= 4 && parts[2] === "pull-requests")
		return at(
			"other",
			parts.slice(0, 2),
			parts[3],
			(n) => `pull-requests/${n}`,
		);
	return null;
}

const URL_IN_TEXT = /https:\/\/[^\s<>()[\]{}"'`|\\^]+/g;

/** Every distinct PR URL in a piece of agent text, in order. */
export function prUrlsIn(text: string): PrUrl[] {
	const seen = new Map<string, PrUrl>();
	for (const m of text.matchAll(URL_IN_TEXT)) {
		const pr = parsePrUrl(m[0].replace(/[.,;:!?*_]+$/, ""));
		if (pr && !seen.has(pr.url)) seen.set(pr.url, pr);
	}
	return [...seen.values()];
}

/** A git remote PrismaLens has configured, as host and repo path. */
export interface KnownRemote {
	repositoryId: string;
	host: string;
	repo: string;
	/** The remote as git reaches it, for the credential lookup. */
	gitUrl: string;
}

export function remoteOf(
	repositoryId: string,
	gitUrl: string,
): KnownRemote | null {
	const host = urlHost(gitUrl);
	const repo = repoPath(gitUrl);
	if (!host || !repo.includes("/") || repo.includes(" ")) return null;
	return { repositoryId, host, repo: repo.toLowerCase(), gitUrl };
}

/**
 * Agent text is untrusted (#1024 decision 2): a PR URL counts only when its host
 * and repo are a configured repository's, compared exactly, so a look-alike host never matches.
 */
export function trustedRemote<T extends KnownRemote>(
	pr: PrUrl,
	remotes: readonly T[],
): T | null {
	return (
		remotes.find(
			(r) => r.host === pr.host && r.repo === pr.repo.toLowerCase(),
		) ?? null
	);
}

/** The API origin comes from the host's adapter, never from the URL's own path. */
export function apiBase(pr: Pick<PrUrl, "host" | "shape">): string | null {
	return codeHost(pr.shape)?.apiBase(pr.host) ?? null;
}
