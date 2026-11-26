// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Scratch: the PR 2 sim check for D25's "Group threads: State". Not for merge.
import { bucketOf } from "@prismalens/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import {
	useAsksByThread,
	useThreadListModel,
} from "@/components/shell/ThreadList";
import { ThreadTreeView } from "@/components/shell/ThreadTree";
import { useNow } from "@/hooks/use-now";
import type { ListNode, ThreadListModel } from "@/lib/thread-list";

export const Route = createFileRoute("/_authenticated/lab-grouping")({
	component: LabGrouping,
});

const GROUPS = [
	{ id: "working", label: "Working" },
	{ id: "waiting", label: "Waiting" },
	{ id: "done", label: "Finished" },
] as const;

const only = (m: ThreadListModel, part: Partial<ThreadListModel>) => ({
	...m,
	needs: [],
	pinned: [],
	active: [],
	settled: [],
	settledCount: 0,
	...part,
});

function useFold(id: string) {
	const key = `pl.lab.fold.${id}`;
	const [open, setOpen] = useState(() => {
		try {
			return localStorage.getItem(key) !== "0";
		} catch {
			return true;
		}
	});
	const toggle = () =>
		setOpen((o) => {
			try {
				localStorage.setItem(key, o ? "0" : "1");
			} catch {}
			return !o;
		});
	return [open, toggle] as const;
}

function Group({
	id,
	label,
	rows,
	model,
	tree,
	keep = 0,
}: {
	/** Rows a folded group still shows: its most recent ones. */
	keep?: number;
	id: string;
	label: string;
	rows: ListNode[];
	model: ThreadListModel;
	tree: Omit<React.ComponentProps<typeof ThreadTreeView>, "model">;
}) {
	const [open, toggle] = useFold(id);
	if (!rows.length) return null;
	return (
		<section data-testid={`group-${id}`} className="flex flex-col">
			<button
				type="button"
				aria-expanded={open}
				onClick={toggle}
				className="flex h-7 items-center gap-1.5 rounded-control px-2.5 text-meta text-text-3 hover:bg-surface-2 hover:text-text-1"
				data-testid={`group-${id}-toggle`}
			>
				<ChevronRight
					aria-hidden
					className={open ? "size-3 rotate-90" : "size-3"}
				/>
				{label}
				<span className="ml-auto tabular-nums">{rows.length}</span>
			</button>
			{(open || keep > 0) && (
				<div className="lab-sub">
					<ThreadTreeView
						{...tree}
						model={only(model, {
							active: open
								? rows
								: [...rows].sort((x, y) => y.at - x.at).slice(0, keep),
						})}
						expandAll
					/>
				</div>
			)}
		</section>
	);
}

/** Recent (the real sidebar) beside State, from the same live feed. */
function LabGrouping() {
	const { model } = useThreadListModel();
	const asks = useAsksByThread();
	const now = useNow(30_000) ?? 0;
	const tree = { asks, now, currentId: null };
	const by = (b: string) =>
		model.active.filter((n) => bucketOf(n.info.status) === b);
	return (
		<div className="flex gap-6 p-4" data-testid="lab-grouping">
			<style>{`.lab-sub [data-testid="thread-section-threads"] > :first-child, .lab-edge [data-testid="thread-section-threads"] { display: none }`}</style>
			<div
				className="flex max-h-[calc(100dvh-2rem)] w-[300px] shrink-0 flex-col gap-2 overflow-y-auto"
				data-testid="state-list"
			>
				<div className="lab-edge">
					<ThreadTreeView
						{...tree}
						model={only(model, {
							needs: model.needs,
							pinned: model.pinned,
							needsCount: model.needsCount,
						})}
					/>
				</div>
				<h2 className="px-2.5 text-meta font-medium text-text-3">Threads</h2>
				{GROUPS.map((g) => (
					<Group
						key={g.id}
						id={g.id}
						label={g.label}
						rows={by(g.id)}
						model={model}
						tree={tree}
						keep={g.id === "done" ? 3 : 0}
					/>
				))}
				<div className="lab-edge">
					<ThreadTreeView
						{...tree}
						model={only(model, {
							settled: model.settled,
							settledCount: model.settledCount,
						})}
					/>
				</div>
			</div>
			<p className="text-meta text-text-3" data-testid="lab-counts">
				{GROUPS.map((g) => `${g.label} ${by(g.id).length}`).join(" · ")} · Needs
				you {model.needs.length} · Pinned {model.pinned.length} · Settled{" "}
				{model.settled.length}
			</p>
		</div>
	);
}
