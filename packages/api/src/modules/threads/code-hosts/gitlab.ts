// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** GitLab's merge requests and pipeline jobs, behind the code-host seam (#1122). */
import type {
	PrCheckRun,
	PrFile,
	PrMergeState,
	PrPerson,
	PrReview,
	PrReviewer,
	PrReviewThread,
	PrState,
} from "@prismalens/contracts";
import {
	NO_CHECKS,
	PR_FILES_MAX,
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
	FILES_PAGES,
	type FilesRead,
	firstWebUrl,
	type HeadRead,
	type HostRead,
	HostReadError,
	HostWriteError,
	hostPost,
	idOf,
	isPerson,
	items,
	jsonOf,
	LOG_TAIL,
	LOG_UNAVAILABLE,
	type LogShape,
	logLines,
	obj,
	type PrActivityItem,
	person,
	prFile,
	type ReplyPosted,
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
	sourceProject: number | null;
	targetProject: number | null;
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
				sourceProject:
					typeof m.source_project_id === "number" ? m.source_project_id : null,
				targetProject:
					typeof m.target_project_id === "number" ? m.target_project_id : null,
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
		? await gitlabJobs(req, base, mr.pipelineId, mr.sha, cache)
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
		// A fork's project is known here by id only, so it never equals the target's path (#1176 D4.4).
		headRepo:
			mr.sourceProject === null || mr.targetProject === null
				? null
				: mr.sourceProject === mr.targetProject
					? project
					: `project-id:${mr.sourceProject}`,
		baseRef: mr.baseRef,
	};
}

const JOB_PAGES = 10;
const GITLAB_RERUNNABLE = new Set(["failed", "canceled", "success"]);

function gitlabJob(
	raw: unknown,
	pipelineId: number,
	sha: string | null,
): PrCheckRun {
	const o = obj(raw);
	const s = str(o.status) ?? "";
	return run(
		str(o.name),
		GITLAB_PENDING.has(s) || (s === "manual" && o.allow_failure !== true)
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
			headSha: str(obj(o.commit).id) ?? sha ?? undefined,
			url: str(o.web_url),
			cancelled: s === "canceled" || s === "canceling",
			rerunnable: GITLAB_RERUNNABLE.has(s),
			group: String(pipelineId),
		},
	);
}

/** A pipeline's jobs, a page of 100 at a time, at most JOB_PAGES pages (#1176 D15). */
async function gitlabJobs(
	req: AuthenticatedRequestFn,
	base: string,
	pipelineId: number,
	sha: string | null,
	cache: EtagCache,
): Promise<ChecksRead> {
	const all: PrCheckRun[] = [];
	for (let page = 1; page <= JOB_PAGES; page++) {
		const got = await cachedGet(
			req,
			`${base}/pipelines/${pipelineId}/jobs?per_page=100${page > 1 ? `&page=${page}` : ""}`,
			cache,
			(b) => arr(b).map((j) => gitlabJob(j, pipelineId, sha)),
		);
		all.push(...got);
		if (got.length < 100) break;
	}
	return tally(all);
}

/** A merge request's diffs, falling back to its changes on an older GitLab (#1176 D14). */
async function readGitlabFiles(
	req: AuthenticatedRequestFn,
	project: string,
	iid: number,
): Promise<FilesRead> {
	const base = `projects/${encodeURIComponent(project)}/merge_requests/${iid}`;
	const fileOf = (raw: unknown): PrFile | null => {
		const d = obj(raw);
		const path = str(d.new_path) ?? str(d.old_path);
		if (!path) return null;
		const diff = str(d.diff);
		let additions = 0;
		let deletions = 0;
		for (const line of (diff ?? "").split("\n")) {
			if (line.startsWith("+") && !line.startsWith("+++")) additions++;
			else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
		}
		return prFile({
			path,
			previousPath: str(d.old_path),
			status:
				d.new_file === true
					? "added"
					: d.deleted_file === true
						? "removed"
						: d.renamed_file === true
							? "renamed"
							: "modified",
			additions,
			deletions,
			patch: diff,
		});
	};
	const files: PrFile[] = [];
	for (let page = 1; page <= FILES_PAGES; page++) {
		const res = await req("GET", `${base}/diffs?per_page=100&page=${page}`, {
			headers: { Accept: "application/json" },
		});
		if (res.status === 404 && page === 1) {
			await res.body?.cancel();
			const changes = arr(
				obj(
					await jsonOf(
						await req("GET", `${base}/changes`, {
							headers: { Accept: "application/json" },
						}),
					),
				).changes,
			);
			const all = changes.map(fileOf).filter((f): f is PrFile => !!f);
			return {
				files: all.slice(0, PR_FILES_MAX),
				truncated: all.length > PR_FILES_MAX,
			};
		}
		const got = arr(await jsonOf(res));
		files.push(...got.map(fileOf).filter((f): f is PrFile => !!f));
		if (got.length < 100)
			return { files: files.slice(0, PR_FILES_MAX), truncated: false };
	}
	return { files: files.slice(0, PR_FILES_MAX), truncated: true };
}
/** GitLab: a job's stage and its trace's tail. */
export async function readGitlabJobLog(
	req: AuthenticatedRequestFn,
	project: string,
	jobId: string,
	shape: LogShape = LOG_TAIL,
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
	const { lines, truncated } = await logLines(trace, shape);
	return {
		step,
		lines,
		unavailable: lines.length ? null : LOG_UNAVAILABLE.none,
		truncated,
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
		...(typeof id === "number" ? { activity: { source: "note", id } } : {}),
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
	readViewer: (req, cache) =>
		cachedGet(req, "user", cache, (b) => str(obj(b).username)).catch(
			() => null,
		),
	replyToReviewThread: (req, repo, number, threadId, body) =>
		replyGitlabReviewThread(req, repo, number, threadId, body),
	readReviewThreads: (req, project, iid) =>
		readGitlabThreads(req, project, iid),
	readCheckLog: (access, project, job) =>
		readGitlabJobLog(access.req, project, job.id as string, access.shape),
	findByBranch: (req, project, branch) =>
		firstWebUrl(
			req,
			`projects/${encodeURIComponent(project)}/merge_requests?per_page=5&source_branch=${encodeURIComponent(branch)}`,
			"web_url",
		),
	rerunCheck: (req, project, job) =>
		hostPost(
			req,
			`projects/${encodeURIComponent(project)}/jobs/${job.id}/retry`,
		),
	readFiles: readGitlabFiles,
};
