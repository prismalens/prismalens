// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Add project → From GitHub, GitLab or Bitbucket (#1024 E): one page of the
 * repositories a token can see, most recently pushed first. The caller signs
 * each request; this only builds paths and reads answers.
 */

export type GitHostKind = "github" | "gitlab" | "bitbucket";

export interface HostRepositoryRow {
	fullName: string;
	url: string;
	private: boolean;
	pushedAt: string | null;
	description?: string;
	ownerAvatarUrl?: string;
}

export interface HostRepositoryPage {
	repositories: HostRepositoryRow[];
	hasMore: boolean;
}

/** GETs `path` (absolute URL) with the host's credential and returns the parsed JSON. */
export type HostGet = (url: string) => Promise<unknown>;

export const HOST_PAGE_SIZE = 30;

/** github.com and bitbucket.org by name; any other host is taken as GitLab, self-managed included. */
export function gitHostKind(
	host: string,
	githubHosts: string[] = [],
): GitHostKind {
	const h = host.toLowerCase();
	if (h === "github.com" || githubHosts.includes(h)) return "github";
	if (h === "bitbucket.org") return "bitbucket";
	return "gitlab";
}

/** The REST API root for a git host. */
export function hostApiBase(kind: GitHostKind, host: string): string {
	const h = host.toLowerCase();
	if (kind === "github")
		return h === "github.com"
			? "https://api.github.com"
			: `https://${h}/api/v3`;
	if (kind === "bitbucket") return "https://api.bitbucket.org/2.0";
	return `https://${h}/api/v4`;
}

const text = (v: unknown): string | undefined =>
	typeof v === "string" && v.trim() ? v : undefined;

/** Only an https image URL is passed on; anything else is dropped. */
function httpsUrl(v: unknown, base?: string): string | undefined {
	const raw = text(v);
	if (!raw) return undefined;
	try {
		const url = new URL(raw, base);
		return url.protocol === "https:" ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

/** A clone URL never carries the user name Bitbucket puts in it. */
function cloneUrl(v: unknown): string | null {
	const raw = text(v);
	if (!raw) return null;
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:") return null;
		url.username = "";
		url.password = "";
		return url.toString();
	} catch {
		return null;
	}
}

type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});

function github(rows: unknown[]): HostRepositoryRow[] {
	return rows.flatMap((r) => {
		const row = obj(r);
		const url = cloneUrl(row.clone_url);
		const fullName = text(row.full_name);
		if (!url || !fullName) return [];
		return [
			{
				fullName,
				url,
				private: row.private === true,
				pushedAt: text(row.pushed_at) ?? null,
				description: text(row.description),
				ownerAvatarUrl: httpsUrl(obj(row.owner).avatar_url),
			},
		];
	});
}

function gitlab(rows: unknown[], origin: string): HostRepositoryRow[] {
	return rows.flatMap((r) => {
		const row = obj(r);
		const url = cloneUrl(row.http_url_to_repo);
		const fullName = text(row.path_with_namespace);
		if (!url || !fullName) return [];
		return [
			{
				fullName,
				url,
				private: row.visibility !== "public",
				pushedAt: text(row.last_activity_at) ?? null,
				description: text(row.description),
				ownerAvatarUrl: httpsUrl(obj(row.namespace).avatar_url, origin),
			},
		];
	});
}

function bitbucket(rows: unknown[]): HostRepositoryRow[] {
	return rows.flatMap((r) => {
		const row = obj(r);
		const clone = (
			Array.isArray(obj(row.links).clone)
				? (obj(row.links).clone as unknown[])
				: []
		)
			.map(obj)
			.find((c) => c.name === "https");
		const url = cloneUrl(clone?.href);
		const fullName = text(row.full_name);
		if (!url || !fullName) return [];
		return [
			{
				fullName,
				url,
				private: row.is_private === true,
				pushedAt: text(row.updated_on) ?? null,
				description: text(row.description),
				ownerAvatarUrl: httpsUrl(obj(obj(obj(row.owner).links).avatar).href),
			},
		];
	});
}

/** The request path for one page, in the order each host can sort by recent pushes. */
export function hostRepositoriesUrl(
	kind: GitHostKind,
	apiBase: string,
	opts: { search?: string; page?: number },
): string {
	const page = opts.page ?? 1;
	const search = opts.search?.trim();
	const q = new URLSearchParams();
	if (kind === "github") {
		q.set("per_page", String(HOST_PAGE_SIZE));
		q.set("page", String(page));
		if (search) {
			q.set("q", `${search} in:name`);
			q.set("sort", "updated");
			return `${apiBase}/search/repositories?${q}`;
		}
		q.set("sort", "pushed");
		q.set("direction", "desc");
		q.set("affiliation", "owner,collaborator,organization_member");
		return `${apiBase}/user/repos?${q}`;
	}
	if (kind === "gitlab") {
		q.set("membership", "true");
		q.set("order_by", "last_activity_at");
		q.set("sort", "desc");
		q.set("per_page", String(HOST_PAGE_SIZE));
		q.set("page", String(page));
		if (search) q.set("search", search);
		return `${apiBase}/projects?${q}`;
	}
	q.set("role", "member");
	q.set("sort", "-updated_on");
	q.set("pagelen", String(HOST_PAGE_SIZE));
	q.set("page", String(page));
	if (search) q.set("q", `name ~ "${search.replace(/["\\]/g, "")}"`);
	return `${apiBase}/repositories?${q}`;
}

export async function listHostRepositories(
	kind: GitHostKind,
	host: string,
	get: HostGet,
	opts: { search?: string; page?: number } = {},
): Promise<HostRepositoryPage> {
	const apiBase = hostApiBase(kind, host);
	const body = await get(hostRepositoriesUrl(kind, apiBase, opts));
	if (kind === "github") {
		const rows = Array.isArray(body)
			? body
			: ((obj(body).items as unknown[]) ?? []);
		return {
			repositories: github(rows),
			hasMore: rows.length >= HOST_PAGE_SIZE,
		};
	}
	if (kind === "gitlab") {
		const rows = Array.isArray(body) ? body : [];
		return {
			repositories: gitlab(rows, `https://${host.toLowerCase()}`),
			hasMore: rows.length >= HOST_PAGE_SIZE,
		};
	}
	const page = obj(body);
	const rows = Array.isArray(page.values) ? page.values : [];
	return {
		repositories: bitbucket(rows),
		hasMore: typeof page.next === "string",
	};
}
