// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { repoPath, urlHost } from "../../core/harness/git-credential.js";
import { gitEnv } from "../../core/harness/git-env.js";
import {
	GIT_LS_REMOTE_TIMEOUT_MS,
	spawnGit,
} from "../../core/harness/git-spawn.js";

/** One change that landed on the default branch: a merge, or a commit pushed straight to it. */
export interface GitChange {
	sha: string;
	parents: number;
	committedAt: Date;
	author: string;
	subject: string;
	body: string;
	tag: string | null;
	files: string[];
}

const RS = "\x1e";
const US = "\x1f";
const END = "\x1d";
const FORMAT = `${RS}%H${US}%P${US}%cI${US}%an${US}%D${US}%s${US}%b${END}`;

export interface HistoryQuery {
	/** A folder's working tree or a bare mirror. */
	gitDir: string;
	/** `HEAD`, or `refs/heads/<branch>`; never user text that could start with `-`. */
	ref: string;
	since: Date;
	until: Date;
	/** A monorepo service's folder inside the repository. */
	subPath?: string | null;
	max: number;
}

/**
 * The first-parent history of `ref` in the window: one entry per change as it landed,
 * each merge with the files it brought in (diffed against the branch it merged into).
 */
export async function readHistory(q: HistoryQuery): Promise<GitChange[]> {
	const args = [
		"log",
		"--first-parent",
		"--diff-merges=first-parent",
		"--name-only",
		"--no-renames",
		"--decorate-refs=refs/tags/",
		`--format=${FORMAT}`,
		`--since=${q.since.toISOString()}`,
		`--until=${q.until.toISOString()}`,
		`--max-count=${q.max}`,
		q.ref,
		"--",
		...(q.subPath ? [q.subPath] : []),
	];
	const { stdout } = await spawnGit(args, {
		cwd: q.gitDir,
		env: gitEnv({ source: "machine" }),
		timeoutMs: GIT_LS_REMOTE_TIMEOUT_MS,
	});
	return parseHistory(stdout);
}

export function parseHistory(stdout: string): GitChange[] {
	const out: GitChange[] = [];
	for (const record of stdout.split(RS)) {
		const end = record.indexOf(END);
		if (end < 0) continue;
		const [sha, parents, date, author, refs, subject, body] = record
			.slice(0, end)
			.split(US);
		if (!sha || !date) continue;
		out.push({
			sha,
			parents: parents ? parents.split(" ").filter(Boolean).length : 0,
			committedAt: new Date(date),
			author: author ?? "",
			subject: subject ?? "",
			body: (body ?? "").trim(),
			tag: tagOf(refs ?? ""),
			files: record
				.slice(end + 1)
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean),
		});
	}
	return out;
}

function tagOf(refs: string): string | null {
	for (const part of refs.split(",")) {
		const m = /^\s*tag: (.+?)\s*$/.exec(part);
		if (m?.[1]) return m[1];
	}
	return null;
}

const GITHUB_MERGE = /^Merge pull request #(\d+)/;
const SQUASH_PR = /\(#(\d+)\)\s*$/;
const MERGE_REQUEST = /See merge request \S*!(\d+)/;

/** What the overview shows for a change: a merge's title is the request's, not "Merge pull request #12 from…". */
export function describeChange(c: GitChange): {
	merge: boolean;
	pr: number | null;
	title: string;
} {
	const firstBodyLine = c.body.split("\n")[0]?.trim() ?? "";
	const prText =
		GITHUB_MERGE.exec(c.subject)?.[1] ??
		SQUASH_PR.exec(c.subject)?.[1] ??
		MERGE_REQUEST.exec(c.body)?.[1];
	const pr = prText ? Number(prText) : null;
	const merge = c.parents > 1 || pr !== null;
	const title =
		c.parents > 1 && firstBodyLine && !firstBodyLine.startsWith("See merge")
			? firstBodyLine
			: c.subject;
	return { merge, pr, title: title || c.sha.slice(0, 12) };
}

/** The commit's page on the host, for a remote that names one; hosts on a non-default port get none. */
export function commitUrl(remote: string, sha: string): string | null {
	const host = urlHost(remote);
	if (!host || host.includes(":")) return null;
	const path = repoPath(remote);
	if (!path || path === remote) return null;
	const segment = host === "bitbucket.org" ? "commits" : "commit";
	return `https://${host}/${path}/${segment}/${sha}`;
}
