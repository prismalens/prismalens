// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { useEffect } from "react";
import { markFirstContent } from "@/lib/first-paint";
import { fileFlags } from "@/lib/turn-review";
import type { OkRepo } from "./DiffSurface";

/** A huge diff opens two folders deep, an outline by area; a small one opens whole. */
export const OPEN_TREE_MAX_FILES = 200;
const ROWS = 36;
/** Rows past the stacked layout's six show only beside the diff, where the tree runs full height. */
const STACKED = 6;
const DIR_ROW = "flex h-6 shrink-0 items-center gap-1.5 truncate";
const DIR_ROW_WIDE =
	"hidden h-6 shrink-0 items-center gap-1.5 truncate @2xl:flex";
const FILE_ROW =
	"flex h-6 shrink-0 items-center gap-1.5 rounded-control pr-1 data-[selected]:bg-surface-3 data-[selected]:text-text-1";
const FILE_ROW_WIDE =
	"hidden h-6 shrink-0 items-center gap-1.5 rounded-control pr-1 data-[selected]:bg-surface-3 data-[selected]:text-text-1 @2xl:flex";

export interface DiffTreeProps {
	files: OkRepo["files"];
	outside: Set<string>;
	selected: string | null;
	onPick: (path: string) => void;
	rowCtx: (path: string) => import("./diff.actions").DiffFileCtx;
}

type File = OkRepo["files"][number];
type Dir = { dirs: Map<string, Dir>; files: File[] };
type Row =
	| { kind: "dir"; path: string; name: string; depth: number; open: boolean }
	| { kind: "file"; path: string; name: string; depth: number; file: File };

/** The rows the tree opens on, in its order: folders first, single-folder chains joined. */
export function standInRows(files: readonly File[], max = ROWS): Row[] {
	const root: Dir = { dirs: new Map(), files: [] };
	for (const f of files) {
		const parts = f.path.split("/");
		let at = root;
		for (const p of parts.slice(0, -1)) {
			let next = at.dirs.get(p);
			if (!next) {
				next = { dirs: new Map(), files: [] };
				at.dirs.set(p, next);
			}
			at = next;
		}
		at.files.push(f);
	}
	const openTo =
		files.length > OPEN_TREE_MAX_FILES ? 2 : Number.POSITIVE_INFINITY;
	const out: Row[] = [];
	const byName = (a: string, b: string) => a.localeCompare(b);
	const walk = (dir: Dir, prefix: string, depth: number) => {
		for (const name of Array.from(dir.dirs.keys()).sort(byName)) {
			if (out.length >= max) return;
			let label = name;
			let node = dir.dirs.get(name) as Dir;
			while (node.files.length === 0 && node.dirs.size === 1) {
				const [only, next] = Array.from(node.dirs)[0];
				label = `${label}/${only}`;
				node = next;
			}
			const open = depth < openTo;
			out.push({
				kind: "dir",
				path: `${prefix}${label}/`,
				name: label,
				depth,
				open,
			});
			if (open) walk(node, `${prefix}${label}/`, depth + 1);
		}
		const sorted = [...dir.files].sort((a, b) => byName(a.path, b.path));
		for (const f of sorted) {
			if (out.length >= max) return;
			out.push({
				kind: "file",
				path: f.path,
				name: f.path.slice(prefix.length),
				depth,
				file: f,
			});
		}
	};
	walk(root, "", 0);
	return out;
}

/**
 * The tree's first rows as plain markup: a diff landing's first content, drawn before the
 * tree's code arrives on a slow link, then replaced by it (#1101 category 12). Read-only: a
 * row takes its press once the tree is in, the size it is in the tree on a phone too.
 */
export function DiffTreeStandIn({ files, selected }: DiffTreeProps) {
	useEffect(() => markFirstContent(), []);
	return (
		<div
			className="flex h-44 shrink-0 flex-col overflow-hidden px-2 pt-1 text-[13px] text-text-2 @2xl:h-auto @2xl:min-h-0 @2xl:flex-1"
			data-testid="diff-files-stand-in"
		>
			<div className="mx-2 mb-1 flex h-7 shrink-0 items-center rounded-control bg-surface-2 px-2 text-text-3">
				Search…
			</div>
			{standInRows(files).map((r, i) =>
				r.kind === "dir" ? (
					<div
						key={r.path}
						data-item-path={r.path}
						className={i < STACKED ? DIR_ROW : DIR_ROW_WIDE}
						style={{ paddingLeft: indent(r.depth) }}
					>
						{r.open ? (
							<ChevronDown className="size-3.5 shrink-0 text-text-3" />
						) : (
							<ChevronRight className="size-3.5 shrink-0 text-text-3" />
						)}
						<span className="truncate">{r.name}</span>
					</div>
				) : (
					<div
						key={r.path}
						data-item-path={r.path}
						data-selected={r.path === selected || undefined}
						className={i < STACKED ? FILE_ROW : FILE_ROW_WIDE}
						style={{ paddingLeft: indent(r.depth) }}
					>
						<FileText className="size-3.5 shrink-0 text-text-3" />
						<span className="min-w-0 flex-1 truncate">{r.name}</span>
						<Counts file={r.file} />
					</div>
				),
			)}
		</div>
	);
}

/** The tree's own indent: a file's icon sits where a folder's chevron does. */
const indent = (depth: number) => 15 + depth * 18;

function Counts({ file: f }: { file: File }) {
	if (f.additions === null)
		return <span className="text-text-3">{f.status}</span>;
	const flagged = fileFlags({
		path: f.path,
		add: f.additions,
		del: f.deletions ?? 0,
		status: f.status,
	}).length;
	return (
		<span className="shrink-0 tabular-nums">
			{flagged > 0 && <span className="text-warn">⚑ </span>}
			<span className="text-ok">+{f.additions}</span>
			<span className="text-danger"> −{f.deletions ?? 0}</span>
		</span>
	);
}
