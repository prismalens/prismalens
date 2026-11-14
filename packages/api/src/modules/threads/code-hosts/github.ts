// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** GitHub's pull requests, check runs and commit statuses, behind the code-host seam (#1122). */
import type {
	PrCheckRun,
	PrMergeState,
	PrPerson,
	PrReview,
	PrReviewer,
	PrReviewThread,
	PrState,
} from "@prismalens/contracts";
import {
	NO_CHECKS,
	PR_HOST_TERMS,
	PR_REVIEW_THREADS_MAX,
} from "@prismalens/contracts";
import type { AuthenticatedRequestFn } from "@prismalens/integrations";
import type { CheckLogAccess, CodeHostAdapter } from "./adapter.js";
import {
	arr,
	branchPair,
	type CheckLogRead,
	type ChecksRead,
	cachedGet,
	type EtagCache,
	excerptOf,
	firstWebUrl,
	type HeadRead,
	type HostRead,
	HostReadError,
	idOf,
	imageUrl,
	isPerson,
	items,
	jsonOf,
	LOG_TAIL_LINES,
	LOG_UNAVAILABLE,
	type LogLocate,
	linkOf,
	logTail,
	merged,
	obj,
	type PrActivityItem,
	person,
	readable,
	readLogEnd,
	run,
	str,
	tally,
} from "./common.js";

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
	mergeState: PrMergeState;
	author?: PrPerson;
	requested: PrPerson[];
}

/** GitHub's `mergeable_state`, in the words the panel shows. */
const GITHUB_MERGE: Record<string, PrMergeState> = {
	clean: "clean",
	has_hooks: "clean",
	blocked: "blocked",
	behind: "behind",
	dirty: "conflicts",
	unstable: "unstable",
	draft: "draft",
};

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
				mergeState: GITHUB_MERGE[str(p.mergeable_state) ?? ""] ?? "unknown",
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
			...branchPair(pull.headRef, pull.baseRef),
			mergeState: pull.mergeState,
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

const githubUser = (o: Record<string, unknown>) => ({
	login: str(obj(o.user).login),
	bot: obj(o.user).type === "Bot",
});
/**
 * New reviews and comments on a PR, oldest first; a newer PR history past the
 * first 100 of each kind is not read. Bots count like people.
 */
const GONE: HeadRead = { exists: false, sha: null, forcePushed: false };

/** The head ref's tip, and the PR's last head event: a deleted ref answers 404. */
async function readGithubHead(
	req: AuthenticatedRequestFn,
	repo: string,
	number: number,
	ref: string,
	cache: EtagCache,
): Promise<HeadRead> {
	const path = `repos/${repo}/git/ref/heads/${ref.split("/").map(encodeURIComponent).join("/")}`;
	let sha: string | null;
	try {
		sha = await cachedGet(req, path, cache, (b) => str(obj(obj(b).object).sha));
	} catch (e) {
		if (e instanceof HostReadError && e.status === 404) return GONE;
		throw e;
	}
	// Oldest first and one page: a PR past 100 events reads its first page's last head event.
	const events = await cachedGet(
		req,
		`repos/${repo}/issues/${number}/events?per_page=100`,
		cache,
		(b) =>
			arr(b)
				.map((e) => str(obj(e).event))
				.filter((e): e is string => !!e?.startsWith("head_ref_")),
	);
	return {
		exists: true,
		sha,
		forcePushed: events.at(-1) === "head_ref_force_pushed",
	};
}

async function readGithubActivity(
	req: AuthenticatedRequestFn,
	repo: string,
	number: number,
	cache: EtagCache,
): Promise<PrActivityItem[]> {
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

const REVIEW_THREADS_QUERY = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:${PR_REVIEW_THREADS_MAX}){nodes{id isResolved isOutdated path line originalLine comments(first:1){totalCount nodes{author{login} body url}}}}}}}`;
/** Review threads keep their resolved state in GraphQL only, which needs a token. */
export async function readGithubReviewThreads(
	req: AuthenticatedRequestFn,
	repo: string,
	number: number,
	/** GitHub Enterprise serves GraphQL beside `/api/v3`, not under it. */
	graphqlPath = "graphql",
): Promise<PrReviewThread[]> {
	const [owner, name] = repo.split("/");
	const body = obj(
		await jsonOf(
			await req("POST", graphqlPath, {
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					query: REVIEW_THREADS_QUERY,
					variables: { owner, name, number },
				}),
			}),
		),
	);
	if (arr(body.errors).length)
		throw new HostReadError("the git host refused the review-thread query");
	const nodes = arr(
		obj(obj(obj(obj(body.data).repository).pullRequest).reviewThreads).nodes,
	);
	const out: PrReviewThread[] = [];
	for (const raw of nodes) {
		const t = obj(raw);
		const path = str(t.path);
		if (!path) continue;
		const comments = obj(t.comments);
		const first = obj(arr(comments.nodes)[0]);
		const line =
			typeof t.line === "number"
				? t.line
				: typeof t.originalLine === "number"
					? t.originalLine
					: null;
		const url = linkOf(first.url);
		out.push({
			id: (str(t.id) ?? path).slice(0, 200),
			path: path.slice(0, 1000),
			line: line && line > 0 ? line : null,
			author: (str(obj(first.author).login) ?? "ghost").slice(0, 200),
			resolved: t.isResolved === true,
			outdated: t.isOutdated === true,
			excerpt: excerptOf(str(first.body)),
			replies:
				typeof comments.totalCount === "number"
					? Math.max(comments.totalCount - 1, 0)
					: 0,
			...(url ? { url } : {}),
		});
	}
	return out;
}
/**
 * GitHub: a check run's failing step and log tail. An Actions job shares its check
 * run's id; any other app's check gives its output text and annotations instead.
 */
export async function readGithubCheckLog(
	req: AuthenticatedRequestFn,
	repo: string,
	runId: string,
	locate: LogLocate,
	download: (url: string) => Promise<Response>,
): Promise<CheckLogRead> {
	const base = `repos/${repo}`;
	const jobRes = await req("GET", `${base}/actions/jobs/${runId}`, {
		headers: { Accept: "application/json" },
	});
	if (jobRes.status === 404) {
		await jobRes.body?.cancel();
		return githubCheckOutput(req, base, runId);
	}
	if (jobRes.status === 401 || jobRes.status === 403) {
		await jobRes.body?.cancel();
		return { step: null, lines: [], unavailable: LOG_UNAVAILABLE.noAccess };
	}
	const job = obj(await jsonOf(jobRes));
	const failed = arr(job.steps)
		.map(obj)
		.find((st) => GITHUB_FAILED.has(str(st.conclusion) ?? ""));
	const step = failed
		? ((str(failed.name) ?? null)?.slice(0, 300) ?? null)
		: null;
	const at = await locate(`${base}/actions/jobs/${runId}/logs`);
	if (at.status === 401 || at.status === 403)
		return { step, lines: [], unavailable: LOG_UNAVAILABLE.noAccess };
	if (at.status === 404 || at.status === 410)
		return { step, lines: [], unavailable: LOG_UNAVAILABLE.gone };
	if (!at.location)
		return { step, lines: [], unavailable: LOG_UNAVAILABLE.host };
	const res = await download(at.location);
	if (!res.ok) {
		await res.body?.cancel();
		return { step, lines: [], unavailable: LOG_UNAVAILABLE.gone };
	}
	const lines = logTail(await readLogEnd(res));
	return {
		step,
		lines,
		unavailable: lines.length ? null : LOG_UNAVAILABLE.none,
	};
}

async function githubCheckOutput(
	req: AuthenticatedRequestFn,
	base: string,
	runId: string,
): Promise<CheckLogRead> {
	const res = await req("GET", `${base}/check-runs/${runId}`, {
		headers: { Accept: "application/json" },
	});
	if (res.status === 404) {
		await res.body?.cancel();
		return { step: null, lines: [], unavailable: LOG_UNAVAILABLE.status };
	}
	const output = obj(obj(await jsonOf(res)).output);
	const notes = await req("GET", `${base}/check-runs/${runId}/annotations`, {
		headers: { Accept: "application/json" },
	});
	const marks = notes.ok
		? arr(await notes.json()).map((a) => {
				const o = obj(a);
				const where = str(o.path)
					? `${str(o.path)}:${typeof o.start_line === "number" ? o.start_line : ""} `
					: "";
				return `${where}${str(o.message) ?? ""}`.trim();
			})
		: [];
	if (!notes.ok) await notes.body?.cancel();
	const text = str(output.text) ?? str(output.summary) ?? "";
	const lines = [...logTail(text, LOG_TAIL_LINES - marks.length), ...marks]
		.filter(Boolean)
		.slice(-LOG_TAIL_LINES)
		.map((l) => l.slice(0, 400));
	return {
		step: str(output.title)?.slice(0, 300) ?? null,
		lines,
		unavailable: lines.length ? null : LOG_UNAVAILABLE.none,
	};
}

/** The newest pull request whose head is `branch`, as its web URL. */
async function findGithubByBranch(
	req: AuthenticatedRequestFn,
	repo: string,
	branch: string,
): Promise<string | null> {
	const owner = repo.split("/")[0] ?? "";
	return firstWebUrl(
		req,
		`repos/${repo}/pulls?state=all&per_page=5&head=${encodeURIComponent(`${owner}:${branch}`)}`,
		"html_url",
	);
}

export const github: CodeHostAdapter = {
	kind: "github",
	terms: PR_HOST_TERMS.github,
	apiBase: (host) =>
		host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`,
	parsePath: (parts) =>
		parts.length >= 4 && parts[2] === "pull"
			? { repoParts: parts.slice(0, 2), number: parts[3] }
			: null,
	webPath: (number) => `pull/${number}`,
	read: readGithub,
	readActivity: readGithubActivity,
	readHead: readGithubHead,
	readReviewThreads: (req, repo, number, apiBase) =>
		readGithubReviewThreads(
			req,
			repo,
			number,
			apiBase?.endsWith("/api/v3") ? "../graphql" : "graphql",
		),
	readCheckLog: (access: CheckLogAccess, repo, check: PrCheckRun) =>
		// A commit status has no app and no log behind its link.
		check.appId
			? readGithubCheckLog(
					access.req,
					repo,
					check.id as string,
					access.locate,
					access.download,
				)
			: Promise.resolve({
					step: null,
					lines: [],
					unavailable: LOG_UNAVAILABLE.status,
				}),
	findByBranch: findGithubByBranch,
};
