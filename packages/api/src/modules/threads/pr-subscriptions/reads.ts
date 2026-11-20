// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The subscription's own reads of a PR (#1179 §4.1): every list paged to its end with a
 * durable continuation, never through the panel's 50-caps, and every refusal parsed as
 * a rate limit in GitHub's order (D2). Each request sends an explicit `page=` or is the
 * GraphQL POST, so the proof can tell them from the panel's reads.
 */
import type { PrEventGroup, PrHost } from "@prismalens/contracts";
import type { AuthenticatedRequestFn } from "@prismalens/integrations";
import { TRUNCATED_HEADER } from "../../integrations/source-request.js";
import {
	arr,
	type EtagCache,
	type HostRead,
	HostReadError,
	obj,
	rateLimitRetryAt,
	str,
} from "../code-hosts/common.js";
import type {
	ListCursor,
	ListName,
	PollCursor,
	PollSnapshot,
	SnapCheck,
	SnapIssueEvent,
	SnapItem,
	SnapThread,
} from "./derive.js";

/** Pages one list reads per tick; the next tick carries on from where it stopped. */
const PAGES_PER_TICK = 10;
/** Pages of check runs, statuses and threads read for the current head, every tick. */
const STATE_PAGES = 20;
/** A comment list's `since` steps back this far, so an item at the edge is read twice, never missed. */
const SINCE_OVERLAP_MS = 5 * 60_000;
/** Reviews are read from page 1 this often, to see an older review dismissed. */
const REVIEWS_FULL_MS = 10 * 60_000;
/** A 403/429 with no time named is retried after this. */
const REFUSED_MS = 60_000;

/** The host refused for a while: every read of this origin waits until `retryAt` (D2). */
export class RateLimited extends Error {
	constructor(readonly retryAt: number) {
		super("rate_limited");
		this.name = "RateLimited";
	}
}

interface Page<T> {
	items: T[];
	/** The host's own item count, before `map` filtered any out. */
	raw?: number;
	next: boolean;
	last: number | null;
}

interface Ctx {
	req: AuthenticatedRequestFn;
	cache: EtagCache;
	touched: Set<string>;
	now: Date;
}

function refusal(res: Response, now: Date): RateLimited | null {
	const at = rateLimitRetryAt(res, now.getTime());
	if (at !== undefined) return new RateLimited(at);
	if (res.status === 403 || res.status === 429)
		return new RateLimited(now.getTime() + REFUSED_MS);
	return null;
}

/** A refusal thrown by a shared read (hand-off 32) as ours. */
export function asRateLimited(e: unknown, now: Date): RateLimited | null {
	if (e instanceof RateLimited) return e;
	if (e instanceof HostReadError && e.status !== undefined)
		if (e.retryAt !== undefined) return new RateLimited(e.retryAt);
		else if (e.status === 429)
			return new RateLimited(now.getTime() + REFUSED_MS);
	return null;
}

/** One conditional GET of one page; the answer's `Link` or `x-next-page` says if more follow. */
async function page<T>(
	ctx: Ctx,
	path: string,
	map: (body: unknown) => T[],
): Promise<Page<T>> {
	const prior = ctx.cache[path];
	ctx.touched.add(path);
	const res = await ctx.req("GET", path, {
		headers: {
			Accept: "application/json",
			...(prior ? { "If-None-Match": prior.etag } : {}),
		},
	});
	if (res.status === 304 && prior) return prior.value as Page<T>;
	if (!res.ok) {
		await res.body?.cancel();
		const limited = refusal(res, ctx.now);
		if (limited) throw limited;
		throw new HostReadError(`the git host answered ${res.status}`, res.status);
	}
	if (res.headers.get(TRUNCATED_HEADER))
		throw new HostReadError("the git host's answer was over 1 MB");
	let body: unknown;
	try {
		body = await res.json();
	} catch {
		throw new HostReadError("the git host's answer was not JSON");
	}
	const link = res.headers.get("link") ?? "";
	const nextPage = res.headers.get("x-next-page");
	const totalPages = Number(res.headers.get("x-total-pages"));
	const lastLink = /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link)?.[1];
	const value: Page<T> = {
		items: map(body),
		raw: Array.isArray(body) ? body.length : undefined,
		next: /rel="next"/.test(link) || !!nextPage,
		last: lastLink
			? Number(lastLink)
			: Number.isFinite(totalPages) && totalPages > 0
				? totalPages
				: null,
	};
	const etag = res.headers.get("etag");
	if (etag) ctx.cache[path] = { etag, value };
	else delete ctx.cache[path];
	return value;
}

/** Drops this reader's cached pages no read touched this tick, so the cache never grows. */
export function pruneCache(cache: EtagCache, touched: Set<string>): void {
	for (const k of Object.keys(cache))
		if (k.includes("page=") && !touched.has(k)) delete cache[k];
}

const maxId = (items: { id: number }[]) =>
	items.reduce((m, i) => Math.max(m, i.id), -1);

/**
 * A list with `since` (comments): one traversal keeps `since` fixed; once it ends, the next
 * starts at the newest update seen less the overlap. No cursor: the floor is the last page.
 */
async function sinceList<T extends { id: number; updatedAt: string | null }>(
	ctx: Ctx,
	pathOf: (since: string | undefined, p: number) => string,
	map: (b: unknown) => T[],
	cur: ListCursor | undefined,
): Promise<{ items: T[]; list: ListCursor; floor?: number }> {
	if (!cur) {
		const first = await page(ctx, pathOf(undefined, 1), map);
		const last =
			first.last && first.last > 1
				? await page(ctx, pathOf(undefined, first.last), map)
				: first;
		const newest = latest(last.items);
		return {
			items: [],
			list: {
				...(newest ? { since: back(newest) } : {}),
				page: 1,
			},
			floor: maxId([...first.items, ...last.items]),
		};
	}
	const items: T[] = [];
	const start = Math.max(1, cur.page - 1);
	let p = start;
	let done = false;
	for (; p < start + PAGES_PER_TICK; p++) {
		const r = await page(ctx, pathOf(cur.since, p), map);
		items.push(...r.items);
		if (!r.next || r.items.length < 100) {
			done = true;
			break;
		}
	}
	if (!done) return { items, list: { ...cur, page: p } };
	const newest = latest(items);
	const since =
		newest && (!cur.since || back(newest) > cur.since)
			? back(newest)
			: cur.since;
	return { items, list: { ...(since ? { since } : {}), page: 1 } };
}

function latest(items: { updatedAt: string | null }[]): string | null {
	let best: string | null = null;
	for (const i of items)
		if (i.updatedAt && (!best || i.updatedAt > best)) best = i.updatedAt;
	return best;
}

const back = (iso: string) =>
	new Date(new Date(iso).getTime() - SINCE_OVERLAP_MS).toISOString();

/** A list read from its last page on (reviews, issue events, notes). No cursor: the floor is the last page. */
async function tailList<T extends { id: number }>(
	ctx: Ctx,
	pathOf: (p: number) => string,
	map: (b: unknown) => T[],
	cur: ListCursor | undefined,
	full = false,
): Promise<{ items: T[]; list: ListCursor; floor?: number; more?: boolean }> {
	if (!cur) {
		const first = await page(ctx, pathOf(1), map);
		const lastNo = first.last && first.last > 1 ? first.last : 1;
		const last = lastNo > 1 ? await page(ctx, pathOf(lastNo), map) : first;
		return {
			items: full ? [...first.items, ...(lastNo > 1 ? last.items : [])] : [],
			list: { page: lastNo },
			floor: maxId([...first.items, ...last.items]),
		};
	}
	const items: T[] = [];
	const start = full ? 1 : Math.max(1, cur.page);
	let p = start;
	let lastRead = start;
	let more = false;
	for (; p < start + (full ? STATE_PAGES : PAGES_PER_TICK); p++) {
		const r = await page(ctx, pathOf(p), map);
		items.push(...r.items);
		// A page whose items were all filtered out still moves the tail on (#1179 OBJ-038).
		if (r.items.length || (r.raw ?? 0) > 0) lastRead = p;
		more = r.next;
		if (!r.next) break;
	}
	return {
		items,
		list: { page: Math.max(lastRead, full ? cur.page : 1) },
		...(more ? { more } : {}),
	};
}

// ---- GitHub ---------------------------------------------------------------

type Dated<T> = T & { updatedAt: string | null };

function ghItem(
	source: SnapItem["source"],
	raw: unknown,
): Dated<SnapItem> | null {
	const o = obj(raw);
	const id = typeof o.id === "number" ? o.id : null;
	const user = obj(o.user);
	if (id === null) return null;
	const state = str(o.state);
	const verdict =
		source !== "rv"
			? undefined
			: state === "APPROVED"
				? "approved"
				: state === "CHANGES_REQUESTED"
					? "changes_requested"
					: state === "COMMENTED"
						? "commented"
						: state === "DISMISSED"
							? "dismissed"
							: null;
	if (verdict === null) return null;
	return {
		source,
		id,
		login: str(user.login),
		bot: user.type === "Bot",
		association: str(o.author_association),
		body: (str(o.body) ?? "").slice(0, 8000),
		createdAt: str(o.submitted_at) ?? str(o.created_at),
		updatedAt: str(o.updated_at) ?? str(o.submitted_at) ?? str(o.created_at),
		link: str(o.html_url),
		...(verdict ? { verdict } : {}),
		...(source === "rc"
			? {
					path: str(o.path),
					line:
						typeof o.line === "number"
							? o.line
							: typeof o.original_line === "number"
								? o.original_line
								: null,
				}
			: {}),
	};
}

const ghItems = (source: SnapItem["source"]) => (b: unknown) =>
	arr(b)
		.map((r) => ghItem(source, r))
		.filter((x): x is Dated<SnapItem> => x !== null);

const EVENTS = new Set([
	"head_ref_force_pushed",
	"merged",
	"closed",
	"reopened",
]);

function ghEvents(b: unknown): SnapIssueEvent[] {
	return arr(b).flatMap((raw) => {
		const o = obj(raw);
		const event = str(o.event);
		if (typeof o.id !== "number" || !event || !EVENTS.has(event)) return [];
		return [
			{
				id: o.id,
				event: event as SnapIssueEvent["event"],
				createdAt: str(o.created_at),
				sha: str(o.commit_id),
			},
		];
	});
}

const GITHUB_FAILED = new Set([
	"failure",
	"timed_out",
	"cancelled",
	"action_required",
	"startup_failure",
]);

function ghRun(raw: unknown): SnapCheck | null {
	const o = obj(raw);
	const name = str(o.name);
	if (!name) return null;
	const app = obj(o.app);
	const appId =
		typeof app.id === "number" || typeof app.id === "string"
			? String(app.id)
			: null;
	const c = str(o.conclusion) ?? "";
	return {
		key: appId ? `app:${appId}/${name}` : `status:${name}`,
		name,
		state:
			o.status !== "completed"
				? "pending"
				: GITHUB_FAILED.has(c)
					? "failing"
					: c === "success"
						? "passing"
						: "neutral",
		exec:
			typeof o.id === "number" || typeof o.id === "string"
				? String(o.id)
				: null,
		url: str(o.html_url) ?? str(o.details_url),
	};
}

function ghStatus(raw: unknown): SnapCheck | null {
	const o = obj(raw);
	const name = str(o.context);
	if (!name) return null;
	const s = str(o.state);
	return {
		key: `status:${name}`,
		name,
		state:
			s === "pending"
				? "pending"
				: s === "failure" || s === "error"
					? "failing"
					: s === "success"
						? "passing"
						: "neutral",
		exec: typeof o.id === "number" ? String(o.id) : null,
		url: str(o.target_url),
	};
}

const THREADS_QUERY = `query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id isResolved path line comments(first:1){nodes{url}}}}}}}`;

async function ghThreads(
	ctx: Ctx,
	graphqlPath: string,
	repo: string,
	number: number,
): Promise<SnapThread[]> {
	const [owner, name] = repo.split("/");
	const out: SnapThread[] = [];
	let after: string | null = null;
	for (let i = 0; i < STATE_PAGES; i++) {
		const res = await ctx.req("POST", graphqlPath, {
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				query: THREADS_QUERY,
				variables: { owner, name, number, after },
			}),
		});
		if (!res.ok) {
			await res.body?.cancel();
			const limited = refusal(res, ctx.now);
			if (limited) throw limited;
			throw new HostReadError(
				`the git host answered ${res.status}`,
				res.status,
			);
		}
		let json: Record<string, unknown>;
		try {
			json = obj(await res.json());
		} catch {
			throw new HostReadError("the git host's answer was not JSON");
		}
		const errors = arr(json.errors).map(obj);
		if (errors.some((e) => e.type === "RATE_LIMITED")) {
			const reset = Number(res.headers.get("x-ratelimit-reset"));
			throw new RateLimited(
				reset > 0 ? reset * 1000 : ctx.now.getTime() + REFUSED_MS,
			);
		}
		if (errors.length)
			throw new HostReadError("the git host refused the thread read");
		const threads = obj(
			obj(obj(obj(json.data).repository).pullRequest).reviewThreads,
		);
		for (const n of arr(threads.nodes).map(obj)) {
			const id = str(n.id);
			if (!id) continue;
			out.push({
				id,
				resolved: n.isResolved === true,
				path: str(n.path),
				line: typeof n.line === "number" ? n.line : null,
				url: str(obj(arr(obj(n.comments).nodes)[0]).url),
			});
		}
		const info = obj(threads.pageInfo);
		if (info.hasNextPage !== true) break;
		after = str(info.endCursor);
		if (!after) break;
	}
	return out;
}

async function allPages<T>(
	ctx: Ctx,
	pathOf: (p: number) => string,
	map: (b: unknown) => T[],
	onPartial?: () => void,
): Promise<T[]> {
	const out: T[] = [];
	for (let p = 1; p <= STATE_PAGES; p++) {
		const r = await page(ctx, pathOf(p), map);
		out.push(...r.items);
		if (!r.next || !r.items.length) break;
		if (p === STATE_PAGES) onPartial?.();
	}
	return out;
}

const nonNull = <T>(xs: (T | null)[]) => xs.filter((x): x is T => x !== null);

// ---- GitLab ---------------------------------------------------------------

function glNote(raw: unknown, prUrl: string): Dated<SnapItem> | null {
	const o = obj(raw);
	if (typeof o.id !== "number" || o.system === true) return null;
	const author = obj(o.author);
	const diff = o.type === "DiffNote";
	const pos = obj(o.position);
	return {
		source: diff ? "dn" : "note",
		id: o.id,
		login: str(author.username),
		bot: author.bot === true,
		association: null,
		body: (str(o.body) ?? "").slice(0, 8000),
		createdAt: str(o.created_at),
		updatedAt: str(o.updated_at) ?? str(o.created_at),
		link: `${prUrl}#note_${o.id}`,
		...(diff
			? {
					path: str(pos.new_path) ?? str(pos.old_path),
					line:
						typeof pos.new_line === "number"
							? pos.new_line
							: typeof pos.old_line === "number"
								? pos.old_line
								: null,
				}
			: {}),
	};
}

function glThread(raw: unknown, prUrl: string): SnapThread | null {
	const o = obj(raw);
	const id = str(o.id);
	const notes = arr(o.notes).map(obj);
	const first = notes[0];
	if (!id || !first || first.resolvable !== true) return null;
	const pos = obj(first.position);
	return {
		id,
		resolved: notes.every((n) => n.resolvable !== true || n.resolved === true),
		path: str(pos.new_path) ?? str(pos.old_path),
		line: typeof pos.new_line === "number" ? pos.new_line : null,
		url: typeof first.id === "number" ? `${prUrl}#note_${first.id}` : null,
	};
}

function glJob(raw: unknown): SnapCheck | null {
	const o = obj(raw);
	const name = str(o.name);
	if (!name) return null;
	const s = str(o.status) ?? "";
	const allowed = o.allow_failure === true;
	return {
		key: `status:${name}`,
		name,
		state:
			[
				"created",
				"waiting_for_resource",
				"waiting_for_callback",
				"preparing",
				"pending",
				"running",
				"scheduled",
				"canceling",
			].includes(s) ||
			(s === "manual" && !allowed)
				? "pending"
				: (s === "failed" && !allowed) || s === "canceled"
					? "failing"
					: s === "success"
						? "passing"
						: "neutral",
		exec: typeof o.id === "number" ? String(o.id) : null,
		url: str(o.web_url),
	};
}

// ---- One tick --------------------------------------------------------------

export interface ReadInput {
	req: AuthenticatedRequestFn;
	apiBase: string;
	host: PrHost;
	repo: string;
	number: number;
	prUrl: string;
	read: HostRead;
	cursor: PollCursor | null;
	/** The groups some live subscription on the URL wants. */
	groups: ReadonlySet<PrEventGroup>;
	cache: EtagCache;
	now: Date;
}

/** Everything one tick reads past `readShared`; a refusal throws `RateLimited` with the cursor untouched. */
export async function readTick(
	input: ReadInput,
): Promise<{ snap: PollSnapshot; touched: Set<string> }> {
	const ctx: Ctx = {
		req: input.req,
		cache: input.cache,
		touched: new Set(),
		now: input.now,
	};
	const g = input.groups;
	const c = input.cursor;
	const items: SnapItem[] = [];
	const floors: PollSnapshot["floors"] = {};
	const lists: PollSnapshot["lists"] = {};
	let issueEvents: SnapIssueEvent[] = [];
	let checks: SnapCheck[] | null = null;
	let threads: SnapThread[] | null = null;
	let push: PollSnapshot["push"] = null;
	let reviewsFull = false;
	let pending = false;
	// A check list cut at the page cap says nothing about the runs past it: never "all done" (#1179).
	let checksPartial = false;
	const cutChecks = () => {
		checksPartial = true;
	};
	const list = (n: ListName) => c?.lists[n] as ListCursor | undefined;
	const head = input.read.headSha;
	const strip = <T extends { updatedAt: string | null }>(xs: T[]) =>
		xs.map(({ updatedAt: _u, ...rest }) => rest);

	if (input.host === "github") {
		const base = `repos/${input.repo}`;
		const n = input.number;
		const sinceQ = (s: string | undefined) =>
			s ? `since=${encodeURIComponent(s)}&` : "";
		if (g.has("comments")) {
			const ic = await sinceList(
				ctx,
				(s, p) =>
					`${base}/issues/${n}/comments?${sinceQ(s)}per_page=100&page=${p}`,
				ghItems("ic"),
				list("comments"),
			);
			items.push(...strip(ic.items));
			lists.comments = ic.list;
			pending ||= ic.list.page > 1;
			if (ic.floor !== undefined) floors.ic = ic.floor;
			const rc = await sinceList(
				ctx,
				(s, p) =>
					`${base}/pulls/${n}/comments?${sinceQ(s)}per_page=100&page=${p}`,
				ghItems("rc"),
				list("reviewComments"),
			);
			items.push(...strip(rc.items));
			lists.reviewComments = rc.list;
			pending ||= rc.list.page > 1;
			if (rc.floor !== undefined) floors.rc = rc.floor;
		}
		if (g.has("reviews")) {
			const prevFull = c?.reviewsFullAt ? Date.parse(c.reviewsFullAt) : 0;
			reviewsFull =
				!!list("reviews") && input.now.getTime() - prevFull >= REVIEWS_FULL_MS;
			const rv = await tailList(
				ctx,
				(p) => `${base}/pulls/${n}/reviews?per_page=100&page=${p}`,
				ghItems("rv"),
				list("reviews"),
				reviewsFull,
			);
			items.push(...strip(rv.items));
			lists.reviews = rv.list;
			pending ||= !!rv.more;
			if (rv.floor !== undefined) floors.rv = rv.floor;
		}
		if (g.has("pushes") || g.has("merge_close")) {
			const ev = await tailList(
				ctx,
				(p) => `${base}/issues/${n}/events?per_page=100&page=${p}`,
				ghEvents,
				list("events"),
			);
			issueEvents = ev.items;
			lists.events = ev.list;
			pending ||= !!ev.more;
			if (ev.floor !== undefined) floors.ev = ev.floor;
		}
		if (g.has("checks") && head) {
			const runs = nonNull(
				await allPages(
					ctx,
					(p) => `${base}/commits/${head}/check-runs?per_page=100&page=${p}`,
					(b) => arr(obj(b).check_runs).map(ghRun),
					cutChecks,
				),
			);
			const statuses = nonNull(
				await allPages(
					ctx,
					(p) => `${base}/commits/${head}/statuses?per_page=100&page=${p}`,
					(b) => arr(b).map(ghStatus),
					cutChecks,
				),
			);
			// The newest status per context comes first.
			const byContext = new Map<string, SnapCheck>();
			for (const s of statuses)
				if (!byContext.has(s.key)) byContext.set(s.key, s);
			checks = [...runs, ...byContext.values()];
		}
		if (g.has("review_threads"))
			threads = await ghThreads(
				ctx,
				input.apiBase.endsWith("/api/v3") ? "../graphql" : "graphql",
				input.repo,
				n,
			);
		if (g.has("pushes") && c?.headSha && head && c.headSha !== head) {
			const status = await page(
				ctx,
				`${base}/compare/${c.headSha}...${head}?per_page=1&page=1`,
				(b) => [str(obj(b).status)],
			).catch((e: unknown) => {
				if (e instanceof RateLimited) throw e;
				// A transient failure fails the poll, so the cursor keeps the old head and A...B is read again.
				// No status means an unusable 200 (bad JSON, truncated): it fails the poll too.
				if (
					!(e instanceof HostReadError) ||
					e.status === undefined ||
					e.status >= 500
				)
					throw e;
				return null;
			});
			if (status)
				push = {
					prev: c.headSha,
					next: head,
					ahead: status.items[0] === "ahead",
				};
		}
	} else if (input.host === "gitlab") {
		const base = `projects/${encodeURIComponent(input.repo)}/merge_requests/${input.number}`;
		if (g.has("comments") || g.has("reviews")) {
			const notes = await tailList(
				ctx,
				(p) =>
					`${base}/notes?sort=asc&order_by=created_at&per_page=100&page=${p}`,
				(b) =>
					arr(b)
						.map((r) => glNote(r, input.prUrl))
						.filter((x): x is Dated<SnapItem> => x !== null),
				list("notes"),
			);
			items.push(...strip(notes.items));
			lists.notes = notes.list;
			pending ||= !!notes.more;
			if (notes.floor !== undefined) {
				floors.note = notes.floor;
				floors.dn = notes.floor;
			}
		}
		if (g.has("review_threads"))
			threads = nonNull(
				await allPages(
					ctx,
					(p) => `${base}/discussions?per_page=100&page=${p}`,
					(b) => arr(b).map((r) => glThread(r, input.prUrl)),
				),
			);
		const pipeline = input.read.detail.checkRuns?.find((r) => r.group)?.group;
		if (g.has("checks") && pipeline)
			checks = nonNull(
				await allPages(
					ctx,
					(p) =>
						`projects/${encodeURIComponent(input.repo)}/pipelines/${pipeline}/jobs?per_page=100&page=${p}`,
					(b) => arr(b).map(glJob),
					cutChecks,
				),
			);
	}

	return {
		snap: {
			prUrl: input.prUrl,
			host: input.host,
			state: input.read.state,
			title: input.read.title,
			headSha: head,
			conflicts: input.read.conflicts,
			baseRef: input.read.baseRef,
			items,
			issueEvents,
			checks,
			...(checksPartial ? { checksPartial } : {}),
			threads,
			push,
			reviewsFull,
			lists,
			floors,
			more: pending,
		},
		touched: ctx.touched,
	};
}
