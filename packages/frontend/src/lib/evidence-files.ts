// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type EvidenceUnavailable,
	isSafeRepoPath,
	type RunWorkspace,
} from "@prismalens/contracts";
import type { RunStep } from "@/components/run/run-steps";

/** A file at the commit a run recorded, and the lines a citation points at. */
export interface FileAt {
	repo: string;
	sha: string;
	path: string;
	line: number | null;
	/** The range's last line; equals `line` for a single line. */
	end: number | null;
}

const LINE = /(?::(\d+)(?:[-:](\d+))?|#L(\d+)(?:-L?(\d+))?)$/;

const slashes = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "");

/**
 * A path the agent read or the report cites, as (repo, commit, path from the
 * repo's top): an absolute path in the run's copy, `repo/…` (how a page shows
 * the copy), or a path from the run's cwd. Null when it is outside every repo.
 */
export function locate(
	raw: string,
	ws: RunWorkspace | null | undefined,
	line: number | null = null,
): FileAt | null {
	if (!ws || ws.repos.length === 0) return null;
	let text = slashes(raw.trim().replace(/^[`'"]|[`'"]$/g, ""));
	let end = line;
	const m = LINE.exec(text);
	if (m) {
		line = Number(m[1] ?? m[3]);
		const last = Number(m[2] ?? m[4] ?? line);
		end = last >= line ? last : line;
		text = text.slice(0, m.index);
	}
	const at = (r: RunWorkspace["repos"][number], path: string): FileAt | null =>
		isSafeRepoPath(path)
			? { repo: r.name, sha: r.head, path, line, end }
			: null;
	if (text.startsWith("/") || /^[A-Za-z]:\//.test(text)) {
		for (const r of ws.repos) {
			const dir = `${slashes(r.dir)}/`;
			if (text.startsWith(dir)) return at(r, text.slice(dir.length));
		}
		return null;
	}
	if (ws.layout === "single") {
		const r = ws.repos[0];
		if (!r) return null;
		const rel = text.replace(/^repo\//, "").replace(/^\.\//, "");
		return at(r, r.subPath ? `${slashes(r.subPath)}/${rel}` : rel);
	}
	const [name, ...rest] = text.replace(/^\.\//, "").split("/");
	const r = ws.repos.find((x) => x.name === name);
	return r ? at(r, rest.join("/")) : null;
}

export const sameFile = (
	a: Pick<FileAt, "repo" | "path">,
	b: Pick<FileAt, "repo" | "path">,
) => a.repo === b.repo && a.path === b.path;

/** The file a read step named, located in the run's clone; null for any other step. */
export function stepFile(
	s: RunStep,
	ws: RunWorkspace | null | undefined,
): FileAt | null {
	return s.kind === "file" && s.verb === "Read" && s.path
		? locate(s.path, ws, s.line ?? null)
		: null;
}

/** The read steps that saw this file, for the view's "What the agent saw is in" pills. */
export function readsOf(
	f: Pick<FileAt, "repo" | "path">,
	steps: readonly RunStep[],
	ws: RunWorkspace | null | undefined,
): number[] {
	return steps.flatMap((s) => {
		const at = stepFile(s, ws);
		return at && sameFile(at, f) ? [s.n] : [];
	});
}

/** `src/db/pool.ts:41-42` in an evidence source, located; null when it names no file. */
export function citedFile(
	source: string,
	ws: RunWorkspace | null | undefined,
): FileAt | null {
	const hit =
		/(?:^|[\s(`'"])((?:\/|[A-Za-z]:[\\/])?[\w.@-]+(?:[\\/][\w.@-]+)*\.\w+(?::\d+(?:-\d+)?|#L\d+(?:-L?\d+)?)?)/.exec(
			source,
		);
	return hit?.[1] ? locate(hit[1], ws) : null;
}

/** `line 41` or `lines 41-42`; null when the citation names no line. */
export function linesWord(f: Pick<FileAt, "line" | "end">): string | null {
	if (f.line === null) return null;
	const end = f.end ?? f.line;
	return end === f.line ? `line ${f.line}` : `lines ${f.line}-${end}`;
}

/** What a citation link says it opens: `src/db/pool.ts, lines 41-42, as cloned at 3f9c2e1`. */
export function citationText(f: FileAt): string {
	const lines = linesWord(f);
	return `${f.path}${lines ? `, ${lines}` : ""}, as cloned at ${f.sha.slice(0, 7)}`;
}

/**
 * The file on the code host the clone came from, at the same commit, for the
 * hosts whose file URLs are known; null for a local folder or another host.
 */
export function codeHostUrl(
	repo: Pick<RunWorkspace["repos"][number], "url" | "sourceKind">,
	f: FileAt,
): string | null {
	if (repo.sourceKind === "folder") return null;
	const m =
		/^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/]+@)([^/:]+)(?::\d+)?[/:](.+?)(?:\.git)?\/?$/.exec(
			repo.url.trim(),
		);
	if (!m) return null;
	const [, host = "", project = ""] = m;
	const base = `https://${host}/${project}`;
	const path = f.path.split("/").map(encodeURIComponent).join("/");
	const end = f.end ?? f.line;
	if (host === "github.com" || host.endsWith(".github.com"))
		return `${base}/blob/${f.sha}/${path}${f.line ? `#L${f.line}${end && end !== f.line ? `-L${end}` : ""}` : ""}`;
	if (host === "gitlab.com" || host.startsWith("gitlab."))
		return `${base}/-/blob/${f.sha}/${path}${f.line ? `#L${f.line}${end && end !== f.line ? `-${end}` : ""}` : ""}`;
	if (host === "bitbucket.org")
		return `${base}/src/${f.sha}/${path}${f.line ? `#lines-${f.line}${end && end !== f.line ? `:${end}` : ""}` : ""}`;
	return null;
}

/** What the file view says instead of a file. */
export function unavailableSentence(
	reason: EvidenceUnavailable,
	sha: string,
): string {
	const at = sha.slice(0, 7);
	switch (reason) {
		case "source-removed":
			return "The source this run cloned is gone: its folder was removed, or the mirror was pruned.";
		case "commit-gone":
			return `Commit ${at} is no longer in the repository.`;
		case "not-retained":
			return `Not in the clone at ${at}. The path may have been created during the run, be untracked, or not exist.`;
		case "not-a-file":
			return `At ${at} this path is a folder or a submodule, not a file.`;
	}
}

/** A size in the unit a person reads: `812 KB`, `2.3 MB`. */
export function sizeWord(bytes: number): string {
	if (bytes >= 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
