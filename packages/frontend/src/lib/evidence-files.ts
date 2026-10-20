// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type EvidenceUnavailable,
	isSafeRepoPath,
	type RunWorkspace,
} from "@prismalens/contracts";
import type { RunStep } from "@/components/run/run-steps";

/** A file at the commit a run recorded, and the line a citation points at. */
export interface FileAt {
	repo: string;
	sha: string;
	path: string;
	line: number | null;
}

const LINE = /(?::(\d+)(?:[-:]\d+)?|#L(\d+)(?:-L?\d+)?)$/;

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
	const m = LINE.exec(text);
	if (m) {
		line = Number(m[1] ?? m[2]);
		text = text.slice(0, m.index);
	}
	const at = (r: RunWorkspace["repos"][number], path: string): FileAt | null =>
		isSafeRepoPath(path) ? { repo: r.name, sha: r.head, path, line } : null;
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

export const fileKey = (f: Pick<FileAt, "repo" | "path">) =>
	`${f.repo}\0${f.path}`;

/** One file the agent read: how often, which steps, the lines it asked for. */
export interface FileRead extends FileAt {
	reads: number;
	steps: number[];
}

/**
 * Files the agent read, in the order it first read each: a new read appends
 * or bumps a count, so nothing already listed moves while the run goes on.
 */
export function filesRead(
	steps: readonly RunStep[],
	ws: RunWorkspace | null | undefined,
): FileRead[] {
	const out = new Map<string, FileRead>();
	for (const s of steps) {
		if (s.kind !== "file" || s.verb !== "Read" || !s.path) continue;
		const f = locate(s.path, ws, s.line);
		if (!f) continue;
		const known = out.get(fileKey(f));
		if (known) {
			known.reads++;
			known.steps.push(s.n);
		} else out.set(fileKey(f), { ...f, reads: 1, steps: [s.n] });
	}
	return Array.from(out.values());
}

/** `src/db/pool.ts:41` in an evidence source, located; null when it names no file. */
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

/** What the file view says instead of a file (the docs' unavailable-state table). */
export function unavailableSentence(
	reason: EvidenceUnavailable,
	sha: string,
): string {
	const at = sha.slice(0, 7);
	switch (reason) {
		case "source-removed":
			return "The source this run cloned is gone: the folder was removed, or the mirror was pruned.";
		case "commit-gone":
			return `Commit ${at} is no longer in the repository.`;
		case "not-retained":
			return `Not committed at ${at}: the file was untracked or uncommitted when the run read it, and PrismaLens does not keep those.`;
		case "not-a-file":
			return `At ${at} this path is a folder or a submodule, not a file.`;
	}
}
