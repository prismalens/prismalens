// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Issues and PRs by number or title, for the `#` menu (#1024 decision 2). Each
 * request goes through the same origin-bound request function as PR state.
 */
import type { PrPerson, WorkItem } from "@prismalens/contracts";
import { WORK_ITEM_SEARCH_MAX } from "@prismalens/contracts";
import type { AuthenticatedRequestFn } from "@prismalens/integrations";
import { imageUrl } from "./pr-hosts.js";

export type WorkHost = "github" | "gitlab" | "bitbucket";

/** The host kind a configured remote's name says; null for one PrismaLens cannot tell. */
export function workHostOf(host: string): WorkHost | null {
	if (host === "github.com" || host.startsWith("github.")) return "github";
	if (host === "gitlab.com" || host.startsWith("gitlab.")) return "gitlab";
	if (host === "bitbucket.org") return "bitbucket";
	return null;
}

/** Fixed API origins, as for PR state; never taken from a URL. */
export function workApiBase(host: string, kind: WorkHost): string {
	if (kind === "github")
		return host === "github.com"
			? "https://api.github.com"
			: `https://${host}/api/v3`;
	if (kind === "gitlab") return `https://${host}/api/v4`;
	return "https://api.bitbucket.org/2.0";
}

const obj = (v: unknown): Record<string, unknown> =>
	v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function webUrl(v: unknown): string | null {
	const s = str(v);
	try {
		return s && new URL(s).protocol === "https:" ? s : null;
	} catch {
		return null;
	}
}

function author(login: unknown, avatar: unknown): { author?: PrPerson } {
	const name = str(login);
	if (!name) return {};
	const avatarUrl = imageUrl(avatar);
	return { author: { login: name, ...(avatarUrl ? { avatarUrl } : {}) } };
}

function item(
	kind: WorkItem["kind"],
	number: unknown,
	title: unknown,
	state: WorkItem["state"],
	url: unknown,
	who: { author?: PrPerson },
): WorkItem | null {
	const n = typeof number === "number" ? number : Number(number);
	const href = webUrl(url);
	if (!Number.isInteger(n) || n < 1 || !href) return null;
	return {
		kind,
		number: n,
		title: (str(title) ?? "").slice(0, 300),
		state,
		// A list answer carries no checks or reviews, so an open PR reads open.
		tone: state === "draft" ? "draft" : state,
		url: href,
		...who,
	};
}

function github(raw: unknown): WorkItem | null {
	const o = obj(raw);
	const pr = o.pull_request ? obj(o.pull_request) : null;
	const state: WorkItem["state"] =
		pr && typeof pr.merged_at === "string"
			? "merged"
			: o.state === "closed"
				? "closed"
				: pr && o.draft === true
					? "draft"
					: "open";
	return item(
		pr ? "pull_request" : "issue",
		o.number,
		o.title,
		state,
		o.html_url,
		author(obj(o.user).login, obj(o.user).avatar_url),
	);
}

function gitlab(raw: unknown, kind: WorkItem["kind"]): WorkItem | null {
	const o = obj(raw);
	const s = str(o.state);
	const state: WorkItem["state"] =
		s === "merged"
			? "merged"
			: s === "closed" || s === "locked"
				? "closed"
				: kind === "pull_request" && o.draft === true
					? "draft"
					: "open";
	return item(
		kind,
		o.iid,
		o.title,
		state,
		o.web_url,
		author(obj(o.author).username, obj(o.author).avatar_url),
	);
}

function bitbucket(raw: unknown, kind: WorkItem["kind"]): WorkItem | null {
	const o = obj(raw);
	const s = (str(o.state) ?? "").toUpperCase();
	const state: WorkItem["state"] =
		s === "MERGED"
			? "merged"
			: [
						"DECLINED",
						"SUPERSEDED",
						"RESOLVED",
						"CLOSED",
						"INVALID",
						"DUPLICATE",
						"WONTFIX",
					].includes(s)
				? "closed"
				: o.draft === true
					? "draft"
					: "open";
	const who = obj(o.author ?? o.reporter);
	return item(
		kind,
		o.id,
		o.title,
		state,
		obj(obj(o.links).html).href,
		author(who.nickname ?? who.display_name, obj(obj(who.links).avatar).href),
	);
}

async function getJson(
	req: AuthenticatedRequestFn,
	path: string,
): Promise<unknown> {
	const res = await req("GET", path, {
		headers: { Accept: "application/json" },
	});
	if (!res.ok) {
		await res.body?.cancel();
		return null;
	}
	return res.json().catch(() => null);
}

const defined = (x: WorkItem | null): x is WorkItem => !!x;

/** Every item that number names: GitLab and Bitbucket number issues and PRs apart. */
export async function byNumber(
	req: AuthenticatedRequestFn,
	kind: WorkHost,
	repo: string,
	n: number,
): Promise<WorkItem[]> {
	if (!Number.isInteger(n) || n < 1) return [];
	if (kind === "github") {
		const one = github(await getJson(req, `repos/${repo}/issues/${n}`));
		return one ? [one] : [];
	}
	if (kind === "gitlab") {
		const p = `projects/${encodeURIComponent(repo)}`;
		const [issue, mr] = await Promise.all([
			getJson(req, `${p}/issues/${n}`),
			getJson(req, `${p}/merge_requests/${n}`),
		]);
		return [gitlab(issue, "issue"), gitlab(mr, "pull_request")].filter(defined);
	}
	const p = `repositories/${repo}`;
	const [pr, issue] = await Promise.all([
		getJson(req, `${p}/pullrequests/${n}`),
		getJson(req, `${p}/issues/${n}`),
	]);
	return [bitbucket(issue, "issue"), bitbucket(pr, "pull_request")].filter(
		defined,
	);
}

/** Issues and PRs whose title matches, newest first by the host's own order, at most 20. */
export async function search(
	req: AuthenticatedRequestFn,
	kind: WorkHost,
	repo: string,
	q: string,
): Promise<WorkItem[]> {
	const text = q.trim().slice(0, 200);
	if (!text) return [];
	const max = WORK_ITEM_SEARCH_MAX;
	if (kind === "github") {
		const body = await getJson(
			req,
			`search/issues?per_page=${max}&q=${encodeURIComponent(`repo:${repo} ${text} in:title`)}`,
		);
		return arr(obj(body).items).map(github).filter(defined).slice(0, max);
	}
	if (kind === "gitlab") {
		const p = `projects/${encodeURIComponent(repo)}`;
		const s = encodeURIComponent(text);
		const [issues, mrs] = await Promise.all([
			getJson(req, `${p}/issues?in=title&per_page=${max}&search=${s}`),
			getJson(req, `${p}/merge_requests?in=title&per_page=${max}&search=${s}`),
		]);
		return [
			...arr(mrs).map((x) => gitlab(x, "pull_request")),
			...arr(issues).map((x) => gitlab(x, "issue")),
		]
			.filter(defined)
			.slice(0, max);
	}
	// BBQL quotes a string with double quotes; one inside the query is dropped.
	const bbql = encodeURIComponent(`title ~ "${text.replaceAll('"', "")}"`);
	const p = `repositories/${repo}`;
	const [prs, issues] = await Promise.all([
		getJson(req, `${p}/pullrequests?pagelen=${max}&q=${bbql}`),
		getJson(req, `${p}/issues?pagelen=${max}&q=${bbql}`),
	]);
	return [
		...arr(obj(prs).values).map((x) => bitbucket(x, "pull_request")),
		...arr(obj(issues).values).map((x) => bitbucket(x, "issue")),
	]
		.filter(defined)
		.slice(0, max);
}
