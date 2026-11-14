// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** GitLab's merge requests and pipeline jobs, behind the code-host seam (#1122). */
import type {
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
import type { CodeHostAdapter } from "./adapter.js";
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
	HostWriteError,
	idOf,
	isPerson,
	items,
	jsonOf,
	LOG_UNAVAILABLE,
	logTail,
	obj,
	type PrActivityItem,
	person,
	type ReplyPosted,
	readLogEnd,
	run,
	str,
	tally,
	writeRefusal,
} from "./common.js";

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
	mergeState: PrMergeState;
	author?: PrPerson;
	reviewers: PrPerson[];
}

/** GitLab's `detailed_merge_status`, in the words the panel shows. */
function gitlabMerge(s: string | null): PrMergeState {
	switch (s) {
		case "mergeable":
			return "clean";
		case "conflict":
			return "conflicts";
		case "need_rebase":
			return "behind";
		case "draft_status":
			return "draft";
		case "ci_must_pass":
		case "ci_still_running":
			return "unstable";
		case null:
		case "checking":
		case "unchecked":
			return "unknown";
		default:
			return "blocked";
	}
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
				mergeState: gitlabMerge(str(m.detailed_merge_status)),
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
			...branchPair(mr.headRef, mr.baseRef),
			mergeState: mr.mergeState,
		},
		headSha: mr.sha,
		headRef: mr.headRef,
		// A GitLab MR's source project is read by id, not name: same-project branches only.
		headRepo: project,
		baseRef: mr.baseRef,
	};
}
/** GitLab: a job's stage and its trace's tail. */
export async function readGitlabJobLog(
	req: AuthenticatedRequestFn,
	project: string,
	jobId: string,
): Promise<CheckLogRead> {
	const base = `projects/${encodeURIComponent(project)}/jobs/${jobId}`;
	const jobRes = await req("GET", base, {
		headers: { Accept: "application/json" },
	});
	if (jobRes.status === 401 || jobRes.status === 403) {
		await jobRes.body?.cancel();
		return { step: null, lines: [], unavailable: LOG_UNAVAILABLE.noAccess };
	}
	if (jobRes.status === 404) {
		await jobRes.body?.cancel();
		return { step: null, lines: [], unavailable: LOG_UNAVAILABLE.gone };
	}
	const job = obj(await jsonOf(jobRes));
	const step = str(job.stage)?.slice(0, 300) ?? null;
	const trace = await req("GET", `${base}/trace`, {
		headers: { Accept: "text/plain" },
	});
	if (!trace.ok) {
		await trace.body?.cancel();
		return {
			step,
			lines: [],
			unavailable:
				trace.status === 401 || trace.status === 403
					? LOG_UNAVAILABLE.noAccess
					: LOG_UNAVAILABLE.gone,
		};
	}
	const lines = logTail(await readLogEnd(trace));
	return {
		step,
		lines,
		unavailable: lines.length ? null : LOG_UNAVAILABLE.none,
	};
}

/** Notes on a merge request, oldest first; system notes are the host's own changelog. */
function readGitlabActivity(
	req: AuthenticatedRequestFn,
	project: string,
	iid: number,
	cache: EtagCache,
): Promise<PrActivityItem[]> {
	const base = `projects/${encodeURIComponent(project)}`;
	return cachedGet(
		req,
		`${base}/merge_requests/${iid}/notes?sort=asc&order_by=created_at&per_page=100`,
		cache,
		(b) =>
			items(
				b,
				"note",
				(o) => ({
					login: str(obj(o.author).username),
					bot: obj(o.author).bot === true,
				}),
				(o) => (o.system === true ? null : undefined),
			),
	);
}

/** Resolvable discussions on a merge request, each named resolved or not. */
async function readGitlabThreads(
	req: AuthenticatedRequestFn,
	project: string,
	iid: number,
): Promise<PrReviewThread[]> {
	const body = await jsonOf(
		await req(
			"GET",
			`projects/${encodeURIComponent(project)}/merge_requests/${iid}/discussions?per_page=100`,
			{ headers: { Accept: "application/json" } },
		),
	);
	const out: PrReviewThread[] = [];
	for (const d of arr(body)) {
		const notes = arr(obj(d).notes).map(obj);
		const first = notes[0];
		if (first?.resolvable !== true) continue;
		const pos = obj(first.position);
		const path = str(pos.new_path) ?? str(pos.old_path);
		if (!path) continue;
		const line =
			typeof pos.new_line === "number"
				? pos.new_line
				: typeof pos.old_line === "number"
					? pos.old_line
					: null;
		out.push({
			id: String(obj(d).id ?? first.id).slice(0, 200),
			path: path.slice(0, 1000),
			line: line && line > 0 ? line : null,
			author: (str(obj(first.author).username) ?? "unknown").slice(0, 200),
			resolved: notes.every(
				(n) => n.resolvable !== true || n.resolved === true,
			),
			outdated: false,
			excerpt: excerptOf(str(first.body)),
			replies: Math.max(notes.length - 1, 0),
			...(notes.length > 1
				? {
						last: {
							author: (
								str(obj(notes[notes.length - 1]?.author).username) ?? "unknown"
							).slice(0, 200),
							excerpt: excerptOf(str(notes[notes.length - 1]?.body)),
						},
					}
				: {}),
		});
		if (out.length >= PR_REVIEW_THREADS_MAX) break;
	}
	return out;
}

/** A note on the MR discussion; the note's page is the MR's URL with `#note_<id>`. */
async function replyGitlabReviewThread(
	req: AuthenticatedRequestFn,
	project: string,
	iid: number,
	discussionId: string,
	body: string,
): Promise<ReplyPosted> {
	let res: Response;
	try {
		res = await req(
			"POST",
			`projects/${encodeURIComponent(project)}/merge_requests/${iid}/discussions/${encodeURIComponent(discussionId)}/notes`,
			{
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ body }),
			},
		);
	} catch {
		throw new HostWriteError("unreachable", "The git host did not answer.");
	}
	if (!res.ok) throw await writeRefusal(res);
	const note = obj(await res.json().catch(() => ({})));
	const id = note.id;
	return {
		author: str(obj(note.author).username) ?? "you",
		excerpt: excerptOf(str(note.body) ?? body),
		...(typeof id === "number" || typeof id === "string"
			? { noteId: String(id) }
			: {}),
	};
}

/** The source branch's tip; GitLab keeps no force-push flag a read can see, so it stays false. */
async function readGitlabHead(
	req: AuthenticatedRequestFn,
	project: string,
	_iid: number,
	ref: string,
	cache: EtagCache,
): Promise<HeadRead> {
	try {
		const sha = await cachedGet(
			req,
			`projects/${encodeURIComponent(project)}/repository/branches/${encodeURIComponent(ref)}`,
			cache,
			(b) => str(obj(obj(b).commit).id),
		);
		return { exists: true, sha, forcePushed: false };
	} catch (e) {
		if (e instanceof HostReadError && e.status === 404)
			return { exists: false, sha: null, forcePushed: false };
		throw e;
	}
}

export const gitlab: CodeHostAdapter = {
	kind: "gitlab",
	terms: PR_HOST_TERMS.gitlab,
	apiBase: (host) => `https://${host}/api/v4`,
	parsePath: (parts) => {
		const at = parts.indexOf("-");
		return at >= 2 && parts[at + 1] === "merge_requests"
			? { repoParts: parts.slice(0, at), number: parts[at + 2] }
			: null;
	},
	webPath: (number) => `-/merge_requests/${number}`,
	read: readGitlab,
	readActivity: readGitlabActivity,
	readHead: readGitlabHead,
	replyToReviewThread: (req, repo, number, threadId, body) =>
		replyGitlabReviewThread(req, repo, number, threadId, body),
	readReviewThreads: (req, project, iid) =>
		readGitlabThreads(req, project, iid),
	readCheckLog: (access, project, job) =>
		readGitlabJobLog(access.req, project, job.id as string),
	findByBranch: (req, project, branch) =>
		firstWebUrl(
			req,
			`projects/${encodeURIComponent(project)}/merge_requests?per_page=5&source_branch=${encodeURIComponent(branch)}`,
			"web_url",
		),
};
