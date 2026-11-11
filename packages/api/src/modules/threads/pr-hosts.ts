// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What GitHub and GitLab say about one pull request (#1024): state, review,
 * checks, conflicts, and the people and apps behind them. Every read is
 * conditional on the ETag the last one got. Image URLs are stored, never fetched here.
 */
import type {
	PrCheckRun,
	PrChecks,
	PrDetail,
	PrPerson,
	PrReview,
	PrReviewer,
	PrState,
} from "@prismalens/contracts";
import { NO_CHECKS, PR_CHECK_RUNS_MAX } from "@prismalens/contracts";
import type { AuthenticatedRequestFn } from "@prismalens/integrations";
import { TRUNCATED_HEADER } from "../integrations/source-request.js";

export interface HostRead {
	title: string | null;
	state: PrState;
	review: PrReview;
	checks: PrChecks;
	conflicts: boolean | null;
	detail: PrDetail;
	/** The head commit, its branch and repository, and the branch it merges into. */
	headSha: string | null;
	headRef: string | null;
	headRepo: string | null;
	baseRef: string | null;
}

/** Per request path: the host's ETag and what PrismaLens read from that answer. */
export type EtagCache = Record<string, { etag: string; value: unknown }>;

/** The host refused or failed; the message is PrismaLens's own, never the host's text. */
export class HostReadError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "HostReadError";
	}
}

/** One conditional GET: a 304 hands back what the earlier answer was read as. */
async function cachedGet<T>(
	req: AuthenticatedRequestFn,
	path: string,
	cache: EtagCache,
	read: (body: unknown) => T,
): Promise<T> {
	const prior = cache[path];
	const res = await req("GET", path, {
		headers: {
			Accept: "application/json",
			...(prior ? { "If-None-Match": prior.etag } : {}),
		},
	});
	if (res.status === 304 && prior) return prior.value as T;
	if (!res.ok) {
		await res.body?.cancel();
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
	const value = read(body);
	const etag = res.headers.get("etag");
	if (etag) cache[path] = { etag, value };
	else delete cache[path];
	return value;
}

const obj = (v: unknown): Record<string, unknown> =>
	v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Email-hash avatar services: loading one sends a commit email's hash to a third party (#1024 decision 11). */
const EMAIL_HASH_HOSTS = /(^|\.)(gravatar\.com|libravatar\.org)$/i;

/** An https image URL the host's API named; anything else, or an email-hash avatar, is dropped. */
export function imageUrl(v: unknown): string | undefined {
	const s = str(v);
	if (!s || s.length > 2000) return undefined;
	try {
		const u = new URL(s);
		return u.protocol === "https:" && !EMAIL_HASH_HOSTS.test(u.hostname)
			? s
			: undefined;
	} catch {
		return undefined;
	}
}

function person(login: unknown, avatar: unknown): PrPerson | undefined {
	const name = str(login);
	if (!name) return undefined;
	const avatarUrl = imageUrl(avatar);
	return { login: name.slice(0, 200), ...(avatarUrl ? { avatarUrl } : {}) };
}

const isPerson = (p: PrPerson | undefined): p is PrPerson => !!p;

interface ChecksRead {
	checks: PrChecks;
	runs: PrCheckRun[];
}

/** Summary counts cover every run; only the first PR_CHECK_RUNS_MAX are kept by name. */
function tally(runs: PrCheckRun[]): ChecksRead {
	if (!runs.length) return { checks: NO_CHECKS, runs: [] };
	const failed = runs.filter((r) => r.state === "failing").length;
	const pending = runs.filter((r) => r.state === "pending").length;
	return {
		checks: {
			state: failed ? "failing" : pending ? "pending" : "passing",
			total: runs.length,
			failed,
			pending,
		},
		runs: runs.slice(0, PR_CHECK_RUNS_MAX),
	};
}

type RunIdentity = Partial<Pick<PrCheckRun, "id" | "appId" | "headSha">> & {
	url?: string | null;
};

const idOf = (v: unknown): string | undefined =>
	typeof v === "number" || (typeof v === "string" && v)
		? String(v).slice(0, 100)
		: undefined;

/** An http(s) link the host gave for a check's log; anything else is dropped. */
function linkOf(v: unknown): string | undefined {
	const s = str(v);
	if (!s || s.length > 2000) return undefined;
	try {
		const u = new URL(s);
		return u.protocol === "https:" || u.protocol === "http:" ? s : undefined;
	} catch {
		return undefined;
	}
}

function run(
	name: string | null,
	state: PrCheckRun["state"],
	appName?: string | null,
	appAvatarUrl?: string,
	identity: RunIdentity = {},
): PrCheckRun {
	const url = linkOf(identity.url);
	return {
		name: (name ?? "check").slice(0, 300),
		state,
		...(appName ? { appName: appName.slice(0, 200) } : {}),
		...(appAvatarUrl ? { appAvatarUrl } : {}),
		...(identity.id ? { id: identity.id } : {}),
		...(identity.appId ? { appId: identity.appId } : {}),
		...(identity.headSha ? { headSha: identity.headSha.slice(0, 64) } : {}),
		...(url ? { url } : {}),
	};
}

const GITHUB_FAILED = new Set([
	"failure",
	"timed_out",
	"cancelled",
	"action_required",
	"startup_failure",
]);

interface GithubPull {
	title: string | null;
	state: PrState;
	conflicts: boolean | null;
	sha: string | null;
	headRef: string | null;
	headRepo: string | null;
	baseRef: string | null;
	author?: PrPerson;
	requested: PrPerson[];
}

/** GitHub: the pull, its reviews and its head's check runs, with combined status as the fallback. */
export async function readGithub(
	req: AuthenticatedRequestFn,
	repo: string,
	number: number,
	cache: EtagCache,
): Promise<HostRead> {
	const base = `repos/${repo}`;
	const pull = await cachedGet<GithubPull>(
		req,
		`${base}/pulls/${number}`,
		cache,
		(b) => {
			const p = obj(b);
			const merged = p.merged === true || typeof p.merged_at === "string";
			const state: PrState = merged
				? "merged"
				: p.state === "closed"
					? "closed"
					: p.draft === true
						? "draft"
						: p.state === "open"
							? "open"
							: "unknown";
			const author = person(obj(p.user).login, obj(p.user).avatar_url);
			return {
				title: str(p.title),
				state,
				conflicts:
					p.mergeable === false || p.mergeable_state === "dirty"
						? true
						: p.mergeable === true
							? false
							: null,
				sha: str(obj(p.head).sha),
				headRef: str(obj(p.head).ref),
				headRepo: str(obj(obj(p.head).repo).full_name),
				baseRef: str(obj(p.base).ref),
				...(author ? { author } : {}),
				requested: [
					...arr(p.requested_reviewers).map((r) =>
						person(obj(r).login, obj(r).avatar_url),
					),
					...arr(p.requested_teams).map((t) => person(obj(t).slug, null)),
				].filter(isPerson),
			};
		},
	);
	const reviewed = await cachedGet<PrReviewer[]>(
		req,
		`${base}/pulls/${number}/reviews?per_page=100`,
		cache,
		(b) => {
			const byUser = new Map<string, PrReviewer>();
			for (const r of arr(b)) {
				const o = obj(r);
				const who = person(obj(o.user).login, obj(o.user).avatar_url);
				const s = str(o.state);
				if (!who || !s || s === "PENDING") continue;
				const state =
					s === "APPROVED"
						? "approved"
						: s === "CHANGES_REQUESTED"
							? "changes_requested"
							: "commented";
				// A comment or a dismissal leaves an earlier verdict standing.
				const prior = byUser.get(who.login);
				if (state === "commented" && prior && prior.state !== "commented")
					continue;
				byUser.set(who.login, { ...who, state });
			}
			return [...byUser.values()];
		},
	);
	const states = reviewed.map((r) => r.state);
	const review: PrReview = states.includes("changes_requested")
		? "changes_requested"
		: states.includes("approved")
			? "approved"
			: pull.requested.length
				? "review_required"
				: "none";
	const checks: ChecksRead = pull.sha
		? await githubChecks(req, base, pull.sha, cache)
		: { checks: { ...NO_CHECKS, state: "unknown" }, runs: [] };
	const reviewers: PrReviewer[] = [
		...reviewed,
		...pull.requested
			.filter((p) => !reviewed.some((r) => r.login === p.login))
			.map((p) => ({ ...p, state: "requested" as const })),
	].slice(0, 50);
	return {
		title: pull.title,
		state: pull.state,
		review,
		checks: checks.checks,
		conflicts: pull.conflicts,
		detail: {
			...(pull.author ? { author: pull.author } : {}),
			reviewers,
			checkRuns: checks.runs,
		},
		headSha: pull.sha,
		headRef: pull.headRef,
		headRepo: pull.headRepo,
		baseRef: pull.baseRef,
	};
}

async function githubChecks(
	req: AuthenticatedRequestFn,
	base: string,
	sha: string,
	cache: EtagCache,
): Promise<ChecksRead> {
	const runs = await readable(() =>
		cachedGet(
			req,
			`${base}/commits/${sha}/check-runs?per_page=100`,
			cache,
			(b) =>
				tally(
					arr(obj(b).check_runs).map((r) => {
						const o = obj(r);
						const conclusion = str(o.conclusion) ?? "";
						const app = obj(o.app);
						return run(
							str(o.name),
							o.status !== "completed"
								? "pending"
								: GITHUB_FAILED.has(conclusion)
									? "failing"
									: conclusion === "success"
										? "passing"
										: "neutral",
							str(app.name),
							imageUrl(app.avatar_url ?? obj(app.owner).avatar_url),
							{
								id: idOf(o.id),
								appId: idOf(app.id),
								headSha: str(o.head_sha) ?? sha,
								url: str(o.html_url) ?? str(o.details_url),
							},
						);
					}),
				),
		),
	);
	// Check runs and commit statuses are separate: a failing status beside passing runs still fails.
	const statuses = await readable(() =>
		cachedGet(req, `${base}/commits/${sha}/status`, cache, (b) =>
			tally(
				arr(obj(b).statuses).map((s) => {
					const o = obj(s);
					const raw = str(o.state);
					return run(
						str(o.context),
						raw === "pending"
							? "pending"
							: raw === "failure" || raw === "error"
								? "failing"
								: raw === "success"
									? "passing"
									: "neutral",
						null,
						imageUrl(o.avatar_url),
						{ id: idOf(o.id), headSha: sha, url: str(o.target_url) },
					);
				}),
			),
		),
	);
	return merged(runs, statuses);
}

type SourceRead =
	| { kind: "ok"; value: ChecksRead }
	| { kind: "absent" }
	| { kind: "failed" };

/** 403 and 404 mean the token may not read that source; any other error means its answer is unknown. */
async function readable(read: () => Promise<ChecksRead>): Promise<SourceRead> {
	try {
		return { kind: "ok", value: await read() };
	} catch (e) {
		if (e instanceof HostReadError && (e.status === 403 || e.status === 404))
			return { kind: "absent" };
		return { kind: "failed" };
	}
}

/**
 * Both sources' counts summed, so a failure or a pending result in either one shows.
 * A known failure stays failing; a source that failed, or one that is absent beside a
 * result that would read passing or none, makes the checks unknown.
 */
function merged(...reads: SourceRead[]): ChecksRead {
	const got = reads.flatMap((r) => (r.kind === "ok" ? [r.value] : []));
	const sum = (k: "total" | "failed" | "pending") =>
		got.reduce((n, r) => n + r.checks[k], 0);
	const total = sum("total");
	const failed = sum("failed");
	const pending = sum("pending");
	const runs = got.flatMap((r) => r.runs).slice(0, PR_CHECK_RUNS_MAX);
	const state: PrChecks["state"] = failed
		? "failing"
		: reads.some((r) => r.kind === "failed")
			? "unknown"
			: pending
				? "pending"
				: reads.some((r) => r.kind === "absent")
					? "unknown"
					: total
						? "passing"
						: "none";
	return { checks: { state, total, failed, pending }, runs };
}

/** The pipeline's own status wins over its jobs: a failed or cancelled one never reads passing. */
function withPipeline(jobs: ChecksRead, status: string | null): ChecksRead {
	const c = jobs.checks;
	if (status && GITLAB_STOPPED.has(status) && c.state !== "failing")
		return {
			...jobs,
			checks: {
				...c,
				state: "failing",
				total: Math.max(c.total, 1),
				failed: Math.max(c.failed, 1),
			},
		};
	if (
		status &&
		GITLAB_WAITING.has(status) &&
		c.state !== "failing" &&
		c.state !== "pending"
	)
		return {
			...jobs,
			checks: {
				...c,
				state: "pending",
				total: Math.max(c.total, 1),
				pending: Math.max(c.pending, 1),
			},
		};
	return jobs;
}

const GITLAB_PENDING = new Set([
	"created",
	"waiting_for_resource",
	"preparing",
	"pending",
	"running",
	"scheduled",
]);
/** A pipeline still waiting, a blocking manual job included. */
const GITLAB_WAITING = new Set([...GITLAB_PENDING, "manual"]);
const GITLAB_STOPPED = new Set(["failed", "canceled", "canceling"]);

interface GitlabMr {
	title: string | null;
	state: PrState;
	conflicts: boolean | null;
	pipelineId: number | null;
	pipelineStatus: string | null;
	sha: string | null;
	headRef: string | null;
	baseRef: string | null;
	author?: PrPerson;
	reviewers: PrPerson[];
}

/** GitLab: the merge request, its approvals, and its head pipeline's jobs. */
export async function readGitlab(
	req: AuthenticatedRequestFn,
	project: string,
	iid: number,
	cache: EtagCache,
): Promise<HostRead> {
	const base = `projects/${encodeURIComponent(project)}`;
	const mr = await cachedGet<GitlabMr>(
		req,
		`${base}/merge_requests/${iid}`,
		cache,
		(b) => {
			const m = obj(b);
			const s = str(m.state);
			const draft = m.draft === true || m.work_in_progress === true;
			const pipeline = obj(m.head_pipeline);
			const author = person(obj(m.author).username, obj(m.author).avatar_url);
			return {
				title: str(m.title),
				state:
					s === "merged"
						? "merged"
						: s === "closed" || s === "locked"
							? "closed"
							: s === "opened"
								? draft
									? "draft"
									: "open"
								: "unknown",
				conflicts:
					typeof m.has_conflicts === "boolean" ? m.has_conflicts : null,
				pipelineId: typeof pipeline.id === "number" ? pipeline.id : null,
				pipelineStatus: str(pipeline.status),
				sha: str(m.sha),
				headRef: str(m.source_branch),
				baseRef: str(m.target_branch),
				...(author ? { author } : {}),
				reviewers: arr(m.reviewers)
					.map((r) => person(obj(r).username, obj(r).avatar_url))
					.filter(isPerson),
			};
		},
	);
	let review: PrReview = "unknown";
	let approvers: string[] = [];
	try {
		const read = await cachedGet(
			req,
			`${base}/merge_requests/${iid}/approvals`,
			cache,
			(b) => {
				const a = obj(b);
				const by = arr(a.approved_by)
					.map((x) => str(obj(obj(x).user).username))
					.filter((x): x is string => !!x);
				const left =
					typeof a.approvals_left === "number" ? a.approvals_left : 0;
				const verdict: PrReview =
					a.approved === true && by.length
						? "approved"
						: left > 0
							? "review_required"
							: "none";
				return { review: verdict, approvers: by };
			},
		);
		review = read.review;
		approvers = read.approvers;
	} catch (e) {
		// Approvals are a paid tier on some installs; the MR's state still reads.
		if (!(e instanceof HostReadError)) throw e;
	}
	const jobs: ChecksRead = mr.pipelineId
		? await cachedGet(
				req,
				`${base}/pipelines/${mr.pipelineId}/jobs?per_page=100`,
				cache,
				(b) =>
					tally(
						arr(b).map((j) => {
							const o = obj(j);
							const s = str(o.status) ?? "";
							return run(
								str(o.name),
								GITLAB_PENDING.has(s) ||
									(s === "manual" && o.allow_failure !== true)
									? "pending"
									: (s === "failed" && o.allow_failure !== true) ||
											s === "canceled" ||
											s === "canceling"
										? "failing"
										: s === "success"
											? "passing"
											: "neutral",
								null,
								undefined,
								{
									id: idOf(o.id),
									appId: "gitlab",
									headSha: str(obj(o.commit).id) ?? mr.sha ?? undefined,
									url: str(o.web_url),
								},
							);
						}),
					),
			)
		: { checks: NO_CHECKS, runs: [] };
	const checks = withPipeline(jobs, mr.pipelineStatus);
	const reviewers: PrReviewer[] = mr.reviewers.slice(0, 50).map((r) => ({
		...r,
		state: approvers.includes(r.login) ? "approved" : "requested",
	}));
	return {
		title: mr.title,
		state: mr.state,
		review,
		checks: checks.checks,
		conflicts: mr.conflicts,
		detail: {
			...(mr.author ? { author: mr.author } : {}),
			reviewers,
			checkRuns: checks.runs,
		},
		headSha: mr.sha,
		headRef: mr.headRef,
		// A GitLab MR's source project is read by id, not name: same-project branches only.
		headRepo: project,
		baseRef: mr.baseRef,
	};
}

/** A review or comment on a PR, by the host's id, as the PR status feed reads it (#1024 surface F). */
export interface PrActivityItem {
	/** Which id sequence `id` belongs to: ids only compare within one source. */
	source: "review" | "issue_comment" | "review_comment" | "note";
	id: number;
	login: string;
	bot: boolean;
	/** A review's verdict; absent on a comment. */
	verdict?: "approved" | "changes_requested" | "commented";
	body: string;
}

const numId = (v: unknown): number | null =>
	typeof v === "number" && Number.isSafeInteger(v) ? v : null;

function items(
	body: unknown,
	source: PrActivityItem["source"],
	who: (o: Record<string, unknown>) => { login: string | null; bot: boolean },
	verdict?: (o: Record<string, unknown>) => PrActivityItem["verdict"] | null,
): PrActivityItem[] {
	const out: PrActivityItem[] = [];
	for (const raw of arr(body)) {
		const o = obj(raw);
		const id = numId(o.id);
		const { login, bot } = who(o);
		if (id === null || !login) continue;
		const v = verdict?.(o);
		if (v === null) continue;
		out.push({
			source,
			id,
			login: login.slice(0, 200),
			bot,
			...(v ? { verdict: v } : {}),
			body: (str(o.body) ?? "").slice(0, 2000),
		});
	}
	return out;
}

const githubUser = (o: Record<string, unknown>) => ({
	login: str(obj(o.user).login),
	bot: obj(o.user).type === "Bot",
});

/**
 * New reviews and comments on a PR, oldest first; a newer PR history past the
 * first 100 of each kind is not read. Bots count like people.
 */
export async function readActivity(
	req: AuthenticatedRequestFn,
	shape: "github" | "gitlab",
	repo: string,
	number: number,
	cache: EtagCache,
): Promise<PrActivityItem[]> {
	if (shape === "gitlab") {
		const base = `projects/${encodeURIComponent(repo)}`;
		return cachedGet(
			req,
			`${base}/merge_requests/${number}/notes?sort=asc&order_by=created_at&per_page=100`,
			cache,
			(b) =>
				items(
					b,
					"note",
					(o) => ({
						login: str(obj(o.author).username),
						bot: obj(o.author).bot === true,
					}),
					// System notes are the host's own changelog, not a person's comment.
					(o) => (o.system === true ? null : undefined),
				),
		);
	}
	const base = `repos/${repo}`;
	const reviews = await cachedGet(
		req,
		`${base}/pulls/${number}/reviews?per_page=100`,
		cache,
		(b) =>
			items(b, "review", githubUser, (o) => {
				const s = str(o.state);
				return s === "APPROVED"
					? "approved"
					: s === "CHANGES_REQUESTED"
						? "changes_requested"
						: s === "COMMENTED"
							? "commented"
							: null;
			}),
	);
	const issueComments = await cachedGet(
		req,
		`${base}/issues/${number}/comments?per_page=100`,
		cache,
		(b) => items(b, "issue_comment", githubUser),
	);
	const reviewComments = await cachedGet(
		req,
		`${base}/pulls/${number}/comments?per_page=100`,
		cache,
		(b) => items(b, "review_comment", githubUser),
	);
	return [...reviews, ...issueComments, ...reviewComments];
}
