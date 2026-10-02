// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export interface RepoSourceInput {
	sourceKind?: "folder" | "url" | string | null;
	url?: string | null;
	fullName?: string | null;
}

export interface FormattedRepoSource {
	kind: "folder" | "url";
	label: string;
	title: string;
}

/** Shortens an absolute or long path from the left, keeping trailing segments. */
export function shortenPath(path: string, maxLength = 24): string {
	if (!path || path.length <= maxLength) {
		return path;
	}

	const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
	const segments = normalized.replace(/^\/+/, "").split("/");

	const parts: string[] = [];
	for (let i = segments.length - 1; i >= 0; i--) {
		const seg = segments[i];
		const candidate =
			parts.length === 0 ? `…/${seg}` : `…/${[seg, ...parts].join("/")}`;
		if (candidate.length <= maxLength) {
			parts.unshift(seg);
		} else {
			break;
		}
	}

	if (parts.length === 0) {
		return `…${normalized.slice(-(maxLength - 1))}`;
	}

	return `…/${parts.join("/")}`;
}

/** Formats a git remote URL into host/owner/repo without credentials or .git. */
export function formatGitUrl(raw: string): string {
	const trimmed = raw.trim();
	const normalized = trimmed.replace(/^([\w.-]+)@([^:]+):/, "ssh://$1@$2/");
	try {
		const u = new URL(normalized);
		const host = u.host;
		const path = u.pathname
			.replace(/^\/+/, "")
			.replace(/\.git$/, "")
			.replace(/\/+$/, "");
		return host ? (path ? `${host}/${path}` : host) : path;
	} catch {
		return trimmed
			.replace(/^[a-z]+:\/\//, "")
			.replace(/^[\w.-]+@/, "")
			.replace(/:/, "/")
			.replace(/\.git$/, "")
			.replace(/^\/+/, "")
			.replace(/\/+$/, "");
	}
}

/** Formats a repository source into folder/url kind, compact label, and full hover title. */
export function formatRepoSource(
	repo: RepoSourceInput | null | undefined,
	options?: { maxPathLength?: number },
): FormattedRepoSource {
	const sourceKind = repo?.sourceKind;
	const url = repo?.url ?? "";
	const fullName = repo?.fullName ?? "";
	const title = url || fullName;

	const isExplicitFolder = sourceKind === "folder";
	const isExplicitUrl = sourceKind === "url";
	const looksLikeFolder =
		isExplicitFolder ||
		(!isExplicitUrl &&
			(/^([\\/]|~|[A-Za-z]:[/\\])/.test(url) ||
				(!url && fullName && !fullName.includes("/"))));

	if (looksLikeFolder) {
		const pathToFormat = url || fullName;
		return {
			kind: "folder",
			label: shortenPath(pathToFormat, options?.maxPathLength ?? 24),
			title,
		};
	}

	return {
		kind: "url",
		label: url ? formatGitUrl(url) : fullName,
		title,
	};
}
