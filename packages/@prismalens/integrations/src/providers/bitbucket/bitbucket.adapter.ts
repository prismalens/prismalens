// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Bitbucket Cloud Adapter (#848): the VCS segment over the 2.0 API.
 * Reads only, token injected by the request fn.
 */
import type {
	GitFileContent,
	GitOrganization,
	GitRepository,
} from "@prismalens/config/integrations";
import { providerHttpError } from "../../engine/provider-http-error.js";
import type { GitCommit, GitProvider } from "../git.interface.js";
import type { AuthenticatedRequestFn, ProviderAdapter } from "../types.js";

interface Page<T> {
	values: T[];
	next?: string;
}

interface BitbucketWorkspace {
	uuid: string;
	slug: string;
	name: string;
	links?: { avatar?: { href: string } };
}

interface BitbucketRepo {
	uuid: string;
	name: string;
	full_name: string;
	description?: string;
	language?: string;
	is_private: boolean;
	mainbranch?: { name: string };
	updated_on: string;
	links: {
		html: { href: string };
		clone?: Array<{ name: string; href: string }>;
	};
}

interface BitbucketCommit {
	hash: string;
	date: string;
	message: string;
	author?: { raw?: string; user?: { display_name?: string } };
	parents: Array<{ hash: string }>;
}

interface BitbucketDiffstat {
	new?: { path: string } | null;
	old?: { path: string } | null;
}

interface BitbucketUser {
	uuid: string;
	username?: string;
	nickname?: string;
	display_name?: string;
	links?: { avatar?: { href: string } };
}

const PAGE_CAP = 20;
const API_PREFIX = "/2.0";

async function json<T>(response: Response): Promise<T> {
	if (!response.ok) {
		throw providerHttpError({
			operation: "Bitbucket API request",
			provider: "bitbucket",
			response,
		});
	}
	return response.json() as Promise<T>;
}

/** `next` is an absolute URL; the request fn wants the path under the base (`/2.0`). */
function relativeNext(next: string | undefined): string | null {
	if (!next) return null;
	const url = new URL(next);
	return url.pathname.startsWith(API_PREFIX)
		? `${url.pathname.slice(API_PREFIX.length)}${url.search}`
		: null;
}

async function paginateList<T>(
	request: AuthenticatedRequestFn,
	initialPath: string,
	stop: (item: T) => boolean = () => false,
	max = Number.POSITIVE_INFINITY,
): Promise<T[]> {
	const results: T[] = [];
	let path: string | null = initialPath;
	for (let i = 0; path && i < PAGE_CAP && results.length < max; i++) {
		const page: Page<T> = await json<Page<T>>(await request("GET", path));
		for (const item of page.values) {
			if (stop(item)) return results;
			results.push(item);
		}
		path = relativeNext(page.next);
	}
	return results.slice(0, max);
}

const segments = (value: string) =>
	value.split("/").map(encodeURIComponent).join("/");

function mapRepo(r: BitbucketRepo): GitRepository {
	return {
		id: r.uuid,
		name: r.name,
		fullName: r.full_name,
		description: r.description || undefined,
		language: r.language || undefined,
		defaultBranch: r.mainbranch?.name ?? "main",
		isPrivate: r.is_private,
		url: r.links.html.href,
		cloneUrl: r.links.clone?.find((c) => c.name === "https")?.href,
		updatedAt: r.updated_on,
	};
}

function mapCommit(c: BitbucketCommit): Omit<GitCommit, "files"> {
	const [subject = "", ...rest] = c.message.split("\n");
	return {
		sha: c.hash,
		parents: c.parents.length,
		committedAt: new Date(c.date),
		author: c.author?.user?.display_name ?? c.author?.raw ?? "",
		subject,
		body: rest.join("\n").trim(),
		tag: null,
	};
}

export class BitbucketVcsSegment implements GitProvider {
	readonly name = "bitbucket";

	/** Workspaces are Bitbucket's organizations. */
	async getOrganizations(
		request: AuthenticatedRequestFn,
	): Promise<GitOrganization[]> {
		const spaces = await paginateList<BitbucketWorkspace>(
			request,
			"/workspaces?pagelen=100",
		);
		return spaces.map((w) => ({
			id: w.uuid,
			name: w.slug,
			displayName: w.name,
			avatarUrl: w.links?.avatar?.href,
		}));
	}

	async getRepositories(
		request: AuthenticatedRequestFn,
		org?: string,
	): Promise<GitRepository[]> {
		const path = org
			? `/repositories/${encodeURIComponent(org)}?pagelen=100&sort=-updated_on`
			: "/repositories?role=member&pagelen=100&sort=-updated_on";
		return (await paginateList<BitbucketRepo>(request, path)).map(mapRepo);
	}

	async getFileContents(
		request: AuthenticatedRequestFn,
		repo: string,
		path: string,
		ref?: string,
	): Promise<GitFileContent> {
		const rev =
			ref ??
			(
				await json<BitbucketRepo>(
					await request("GET", `/repositories/${segments(repo)}`),
				)
			).mainbranch?.name ??
			"main";
		const response = await request(
			"GET",
			`/repositories/${segments(repo)}/src/${encodeURIComponent(rev)}/${segments(path)}`,
		);
		if (!response.ok) {
			throw providerHttpError({
				operation: "Bitbucket API request",
				provider: "bitbucket",
				response,
			});
		}
		const content = await response.text();
		return {
			path,
			content,
			encoding: "utf-8",
			sha: rev,
			size: Buffer.byteLength(content),
		};
	}

	/** Bitbucket has no `since` filter: pages come newest first and stop at the first older commit. */
	async getCommitsSince(
		request: AuthenticatedRequestFn,
		repo: string,
		since: Date,
		opts: { branch?: string; max?: number } = {},
	): Promise<Omit<GitCommit, "files">[]> {
		const branch = opts.branch ? `/${encodeURIComponent(opts.branch)}` : "";
		const commits = await paginateList<BitbucketCommit>(
			request,
			`/repositories/${segments(repo)}/commits${branch}?pagelen=100`,
			(c) => new Date(c.date) < since,
			opts.max,
		);
		return commits.map(mapCommit);
	}

	async getCommit(
		request: AuthenticatedRequestFn,
		repo: string,
		sha: string,
	): Promise<GitCommit> {
		const base = `/repositories/${segments(repo)}`;
		const commit = await json<BitbucketCommit>(
			await request("GET", `${base}/commit/${encodeURIComponent(sha)}`),
		);
		const stats = await paginateList<BitbucketDiffstat>(
			request,
			`${base}/diffstat/${encodeURIComponent(sha)}?pagelen=100`,
		);
		const files = stats
			.map((s) => s.new?.path ?? s.old?.path)
			.filter((p): p is string => !!p);
		return { ...mapCommit(commit), files: [...new Set(files)] };
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
		const user = await json<BitbucketUser>(await request("GET", "/user"));
		return {
			id: user.uuid,
			login: user.nickname ?? user.username ?? user.display_name ?? user.uuid,
			name: user.display_name,
			avatarUrl: user.links?.avatar?.href,
		};
	}
}

export class BitbucketAdapter implements ProviderAdapter {
	readonly name = "bitbucket";
	readonly vcs: GitProvider = new BitbucketVcsSegment();
}
