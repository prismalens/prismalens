// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronsDown } from "lucide-react";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import {
	FILE_GROUP_IDS,
	FILE_GROUPS,
	type FileGroup,
	fileGroupOf,
} from "@/lib/file-groups";
import { cn } from "@/lib/utils";

export interface GroupCount {
	group: FileGroup;
	files: number;
	add: number;
	del: number;
}

/** Files and lines per kind, in the registry's order; kinds with no file are left out. */
export function groupCounts(
	files: readonly {
		path: string;
		additions: number | null;
		deletions: number | null;
	}[],
): GroupCount[] {
	const by = new Map<FileGroup, GroupCount>();
	for (const f of files) {
		const group = fileGroupOf(f.path);
		const c = by.get(group) ?? { group, files: 0, add: 0, del: 0 };
		c.files++;
		c.add += f.additions ?? 0;
		c.del += f.deletions ?? 0;
		by.set(group, c);
	}
	return FILE_GROUP_IDS.flatMap((g) => {
		const c = by.get(g);
		return c ? [c] : [];
	});
}

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : `${n}`);

/** One toggle per file kind: its icon and file count; a hidden kind leaves the tree. */
export function FileGroupBar({
	counts,
	hidden,
	onToggle,
}: {
	counts: readonly GroupCount[];
	hidden: ReadonlySet<FileGroup>;
	onToggle: (group: FileGroup) => void;
}) {
	return (
		<fieldset
			aria-label="File kinds"
			className="m-0 flex shrink-0 flex-wrap items-center gap-0.5 border-0 px-1.5 py-1"
			data-testid="diff-groups"
		>
			{counts.map((c) => {
				const view = FILE_GROUPS.views[c.group];
				const Icon = view.icon;
				const on = !hidden.has(c.group);
				return (
					<Hint
						key={c.group}
						label={`${view.label}: ${c.files} ${c.files === 1 ? "file" : "files"}, +${c.add} −${c.del}. ${on ? "Click to hide" : "Click to show"}`}
					>
						<button
							type="button"
							aria-pressed={on}
							aria-label={`${view.label}, ${c.files} ${c.files === 1 ? "file" : "files"}`}
							onClick={() => onToggle(c.group)}
							className={cn(
								"inline-flex h-6 items-center gap-1 rounded-control px-1.5 text-meta tabular-nums outline-none transition-colors duration-(--dur-instant) hover:bg-surface-3 focus-visible:ring-1 focus-visible:ring-accent",
								on ? "text-text-1" : "text-text-3 line-through",
							)}
							data-testid={`diff-group-${c.group}`}
						>
							<Icon aria-hidden className="size-3.5" />
							{k(c.files)}
						</button>
					</Hint>
				);
			})}
		</fieldset>
	);
}

/** A folded file: its kind and size, and one click to fetch its patch. */
export function LoadMark({
	path,
	additions,
	deletions,
	onLoad,
}: {
	path: string;
	additions: number | null;
	deletions: number | null;
	onLoad: () => void;
}) {
	const view = FILE_GROUPS.views[fileGroupOf(path)];
	const Icon = view.icon;
	return (
		<div
			className="flex flex-col items-start gap-2 px-3 py-3"
			data-testid="diff-load"
		>
			<p className="m-0 flex items-center gap-1.5 text-meta text-text-2">
				<Icon aria-hidden className="size-3.5" />
				<span>{view.fold ? view.label : "Large file"}</span>
				{additions !== null && (
					<span className="tabular-nums">
						<span className="text-ok">+{additions}</span>{" "}
						<span className="text-danger">−{deletions ?? 0}</span>
					</span>
				)}
			</p>
			<Button size="sm" onClick={onLoad} data-testid="diff-load-action">
				<ChevronsDown aria-hidden className="size-3.5" />
				Load diff
			</Button>
		</div>
	);
}
