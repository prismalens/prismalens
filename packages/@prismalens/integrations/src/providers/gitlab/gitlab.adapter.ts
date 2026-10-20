// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * GitLab Adapter (#848): the VCS segment for gitlab.com and self-managed hosts.
 * The connection's baseUrl ends in /api/v4; reads only, token injected by the request fn.
 */
import type {
	GitFileContent,
	GitOrganization,
	GitRepository,
} from "@prismalens/config/integrations";
import { providerHttpError } from "../../engine/provider-http-error.js";
import type { GitCommit, GitProvider } from "../git.interface.js";
import type { AuthenticatedRequestFn, ProviderAdapter } from "../types.js";

interface GitLabGroup {
	id: number;
	full_path: string;
	name: string;
	avatar_url: string | null;
	description: string | null;
}

interface GitLabProject {
	id: number;
	name: string;
	path_with_namespace: string;
	description: string | null;
	star_count: number;
	default_branch: string | null;
	visibility: string;
	web_url: string;
	http_url_to_repo: string;
	last_activity_at: string;
}

interface GitLabFile {
	file_path: string;
	content: string;
	encoding: string;
	blob_id: string;
	size: number;
}

interface GitLabUser {
	id: number;
	username: string;
	name: string | null;
	avatar_url: string | null;
}

interface GitLabCommit {
	id: string;
	parent_ids: string[];
	committed_date: string;
	author_name: string;
	title: string;
	message: string;
}

interface GitLabDiff {
	new_path: string;
	old_path: string;
}

const PAGE_CAP = 20;

async function json<T>(response: Response): Promise<T> {
	if (!response.ok) {
		throw providerHttpError({
			operation: "GitLab API request",
			provider: "gitlab",
			response,
		});
	}
	return response.json() as Promise<T>;
}

async function paginateList<T>(
	request: AuthenticatedRequestFn,
	path: string,
	max = Number.POSITIVE_INFINITY,
): Promise<T[]> {
	const results: T[] = [];
	const sep = path.includes("?") ? "&" : "?";
	let page = "1";
	for (let i = 0; page && i < PAGE_CAP && results.length < max; i++) {
		const response = await request("GET", `${path}${sep}page=${page}`);
		results.push(...(await json<T[]>(response)));
		page = response.headers.get("x-next-page") ?? "";
	}
	return results.slice(0, max);
}

const projectId = (repo: string) => encodeURIComponent(repo);

function mapRepo(p: GitLabProject): GitRepository {
	return {
		id: String(p.id),
		name: p.name,
		fullName: p.path_with_namespace,
		description: p.description ?? undefined,
		stars: p.star_count,
		defaultBranch: p.default_branch ?? "main",
		isPrivate: p.visibility !== "public",
		url: p.web_url,
		cloneUrl: p.http_url_to_repo,
		updatedAt: p.last_activity_at,
	};
}

function mapCommit(c: GitLabCommit): Omit<GitCommit, "files"> {
	const subject = c.title || c.message.split("\n")[0] || "";
	return {
		sha: c.id,
		parents: c.parent_ids.length,
		committedAt: new Date(c.committed_date),
		author: c.author_name,
		subject,
		body: c.message.slice(subject.length).trim(),
		tag: null,
	};
}

export class GitLabVcsSegment implements GitProvider {
	readonly name = "gitlab";

	async getOrganizations(
		request: AuthenticatedRequestFn,
	): Promise<GitOrganization[]> {
		const groups = await paginateList<GitLabGroup>(
			request,
			"/groups?min_access_level=10&per_page=100",
		);
		return groups.map((g) => ({
			id: String(g.id),
			name: g.full_path,
			displayName: g.name,
			avatarUrl: g.avatar_url ?? undefined,
			description: g.description ?? undefined,
		}));
	}

	async getRepositories(
		request: AuthenticatedRequestFn,
		org?: string,
	): Promise<GitRepository[]> {
		const path = org
			? `/groups/${projectId(org)}/projects?include_subgroups=true&per_page=100&order_by=last_activity_at`
			: "/projects?membership=true&per_page=100&order_by=last_activity_at";
		return (await paginateList<GitLabProject>(request, path)).map(mapRepo);
	}

	async getFileContents(
		request: AuthenticatedRequestFn,
		repo: string,
		path: string,
		ref?: string,
	): Promise<GitFileContent> {
		const response = await request(
			"GET",
			`/projects/${projectId(repo)}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref ?? "HEAD")}`,
		);
		const file = await json<GitLabFile>(response);
		return {
			path: file.file_path,
			content:
				file.encoding === "base64"
					? Buffer.from(file.content, "base64").toString("utf-8")
					: file.content,
			encoding: "utf-8",
			sha: file.blob_id,
			size: file.size,
		};
	}

	async getCommitsSince(
		request: AuthenticatedRequestFn,
		repo: string,
		since: Date,
		opts: { branch?: string; max?: number } = {},
	): Promise<Omit<GitCommit, "files">[]> {
		const ref = opts.branch
			? `&ref_name=${encodeURIComponent(opts.branch)}`
			: "";
		const commits = await paginateList<GitLabCommit>(
			request,
			`/projects/${projectId(repo)}/repository/commits?since=${encodeURIComponent(since.toISOString())}&first_parent=true&per_page=100${ref}`,
			opts.max,
		);
		return commits.map(mapCommit);
	}

	async getCommit(
		request: AuthenticatedRequestFn,
		repo: string,
		sha: string,
	): Promise<GitCommit> {
		const base = `/projects/${projectId(repo)}/repository/commits/${encodeURIComponent(sha)}`;
		const commit = await json<GitLabCommit>(await request("GET", base));
		const diffs = await paginateList<GitLabDiff>(
			request,
			`${base}/diff?per_page=100`,
		);
		return {
			...mapCommit(commit),
			files: [...new Set(diffs.map((d) => d.new_path))],
		};
	}

	async testConnection(request: AuthenticatedRequestFn): Promise<boolean> {
		try {
			await this.getAuthenticatedUser(request);
			return true;
		} catch {
			return false;
		}
	}

	async getAuthenticatedUser(
		request: AuthenticatedRequestFn,
	): Promise<{ id: string; login: string; name?: string; avatarUrl?: string }> {
		const user = await json<GitLabUser>(await request("GET", "/user"));
		return {
			id: String(user.id),
			login: user.username,
			name: user.name ?? undefined,
			avatarUrl: user.avatar_url ?? undefined,
		};
	}
}

export class GitLabAdapter implements ProviderAdapter {
	readonly name = "gitlab";
	readonly vcs: GitProvider = new GitLabVcsSegment();
}
