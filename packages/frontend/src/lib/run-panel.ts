// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isSafeRepoPath, type RunWorkspace } from "@prismalens/contracts";
import type { RunStep } from "@/components/run/run-steps";
import { type FileAt, locate } from "./evidence-files";

/** The right panel's tabs, as the URL names them (#973). */
export const PANEL_TABS = [
	"summary",
	"files",
	"changes",
	"steps",
	"context",
] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

export function panelTab(v: unknown): PanelTab | undefined {
	return PANEL_TABS.find((t) => t === v);
}

/** `repo:path#L41-L44`: the file in the URL; the commit always comes from the run. */
export function fileParam(f: FileAt): string {
	const range = f.line ? `#L${f.line}-L${f.end ?? f.line}` : "";
	return `${f.repo}:${f.path}${range}`;
}

export function fileFromParam(
	param: string,
	ws: RunWorkspace | null | undefined,
): FileAt | null {
	const m = /^([^:]+):([^#]+)(?:#L(\d+)(?:-L(\d+))?)?$/.exec(param);
	if (!m) return null;
	const [, name, path = "", a, b] = m;
	const repo = ws?.repos.find((r) => r.name === name);
	if (!repo || !isSafeRepoPath(path)) return null;
	const line = a ? Number(a) : null;
	const end = line === null ? null : Math.max(line, b ? Number(b) : line);
	return { repo: repo.name, sha: repo.head, path, line, end };
}

const RANK: Record<string, number> = {
	Cited: 4,
	Edited: 3,
	Wrote: 3,
	Deleted: 3,
	Moved: 3,
	Read: 1,
};

export interface TouchedFile {
	/** Where it sits in the tree: under its repo's name when the run has several. */
	path: string;
	mark: string;
	file: FileAt;
}

/** Every file the run's steps named or the report cited, once, by its strongest mark. */
export function touchedFiles(
	steps: readonly RunStep[],
	ws: RunWorkspace | null | undefined,
	cited: readonly FileAt[],
): TouchedFile[] {
	const many = (ws?.repos.length ?? 0) > 1;
	const byKey = new Map<string, TouchedFile>();
	const put = (file: FileAt, mark: string) => {
		const key = `${file.repo}\0${file.path}`;
		const had = byKey.get(key);
		if (had && (RANK[had.mark] ?? 0) >= (RANK[mark] ?? 0)) return;
		byKey.set(key, {
			path: many ? `${file.repo}/${file.path}` : file.path,
			mark,
			file:
				had && mark !== "Cited"
					? { ...file, line: had.file.line, end: had.file.end }
					: file,
		});
	};
	for (const s of steps) {
		if (s.kind !== "file" || !s.path) continue;
		const f = locate(s.path, ws, s.line ?? null);
		if (f) put(f, s.verb);
	}
	for (const f of cited) put(f, "Cited");
	return Array.from(byKey.values()).sort((x, y) =>
		x.path.localeCompare(y.path),
	);
}

export interface PatchFile {
	path: string;
	oldPath: string | null;
	text: string;
}

/** A multi-file unified patch, one entry per `diff --git` header. */
export function splitPatch(patch: string): PatchFile[] {
	const starts = Array.from(patch.matchAll(/^diff --git /gm)).map(
		(m) => m.index ?? 0,
	);
	return starts.map((start, i) => {
		const text = patch.slice(start, starts[i + 1] ?? patch.length);
		const header = /^diff --git a\/(.+?) b\/(.+)$/m.exec(text);
		const from = /^rename from (.+)$/m.exec(text)?.[1];
		const to = /^rename to (.+)$/m.exec(text)?.[1];
		const path = to ?? header?.[2] ?? "";
		return { path, oldPath: from ?? null, text };
	});
}
