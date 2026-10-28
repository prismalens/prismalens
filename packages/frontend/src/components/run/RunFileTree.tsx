// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { FileTree, useFileTree } from "@pierre/trees/react";
import type { RunWorkspace } from "@prismalens/contracts";
import { useQueries } from "@tanstack/react-query";
import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import { orpc } from "@/lib/api/orpc-client";
import type { FileAt } from "@/lib/evidence-files";
import type { TouchedFile } from "@/lib/run-panel";

const TREE_STYLE = {
	"--trees-fg-override": "var(--text-2)",
	"--trees-selected-bg-override": "var(--surface-3)",
	"--trees-border-color-override": "transparent",
	"--trees-bg-override": "transparent",
	"--trees-font-family-override": "var(--font-sans)",
} as CSSProperties;

/**
 * The Files tab's tree (#973), drawn by `@pierre/trees`: the files the run
 * touched, kept current while it works, or every file at the recorded
 * commit, listed at once so a folder opened by keyboard has its contents.
 */
export function RunFileTree({
	mode,
	runId,
	workspace,
	touched,
	selected,
	onPick,
}: {
	mode: "touched" | "all";
	runId: string;
	workspace: RunWorkspace;
	touched: TouchedFile[];
	selected: FileAt | null;
	onPick: (f: FileAt) => void;
}) {
	const many = workspace.repos.length > 1;
	const all = useQueries({
		queries: workspace.repos.map((r) => ({
			...orpc.investigations.getTree.queryOptions({
				input: { id: runId, sha: r.head, recursive: "true" as const },
			}),
			enabled: mode === "all",
			staleTime: Number.POSITIVE_INFINITY,
			retry: false,
		})),
	});
	const allPaths = useMemo(
		() =>
			all.flatMap((q, i) => {
				const repo = workspace.repos[i];
				if (q.data?.state !== "ok" || !repo) return [];
				const base = many ? `${repo.name}/` : "";
				return q.data.entries.map((e) => `${base}${e.path}`);
			}),
		[all, many, workspace.repos],
	);
	const truncated = all.some((q) => q.data?.state === "ok" && q.data.truncated);
	const paths = mode === "touched" ? touched.map((t) => t.path) : allPaths;

	// The model is built once; the callbacks read the latest marks and pick through refs.
	const marks = useRef(new Map<string, TouchedFile>());
	marks.current = new Map(touched.map((t) => [t.path, t]));
	const pick = useRef(onPick);
	pick.current = onPick;
	const fileAt = (p: string): FileAt | null => {
		if (!many) {
			const repo = workspace.repos[0];
			return repo
				? { repo: repo.name, sha: repo.head, path: p, line: null, end: null }
				: null;
		}
		const [name, ...rest] = p.split("/");
		const repo = workspace.repos.find((r) => r.name === name);
		return repo
			? {
					repo: repo.name,
					sha: repo.head,
					path: rest.join("/"),
					line: null,
					end: null,
				}
			: null;
	};
	const resolve = useRef(fileAt);
	resolve.current = fileAt;

	const { model } = useFileTree({
		paths,
		initialExpansion: mode === "touched" ? "open" : "closed",
		flattenEmptyDirectories: true,
		search: mode === "all",
		density: "compact",
		renderRowDecoration: ({ item }) => {
			const mark = marks.current.get(item.path)?.mark;
			return mark ? { text: mark, title: `${mark} by this run` } : null;
		},
		onSelectionChange: (selection) => {
			const p = selection[0];
			if (!p || p.endsWith("/")) return;
			const hit = marks.current.get(p);
			const f = mode === "touched" ? hit?.file : resolve.current(p);
			if (f) pick.current(f);
		},
	});

	// A live run touches more files, or reads then edits one; the tree follows and repaints its marks (#975 OBJ-011).
	const key = paths.join("\0");
	const markKey = touched.map((t) => t.mark).join(",");
	useEffect(() => {
		model.resetPaths(key ? key.split("\0") : []);
	}, [model, key, markKey]);
	const failed = all.some(
		(q) => q.isError || (q.data && q.data.state !== "ok"),
	);

	// Name the tree: it renders `role=tree` inside an open shadow root with no label (#973 OBJ-010).
	const label =
		mode === "touched"
			? "Files this run touched"
			: `All files at ${workspace.repos[0]?.head.slice(0, 7) ?? ""}`;
	const host = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const name = () => {
			const tree = host.current
				?.querySelector("*")
				?.shadowRoot?.querySelector("[role=tree]");
			tree?.setAttribute("aria-label", label);
			return !!tree;
		};
		if (name()) return;
		const t = window.setInterval(() => {
			if (name()) window.clearInterval(t);
		}, 50);
		return () => window.clearInterval(t);
	}, [label]);

	const selectedPath = selected
		? `${many ? `${selected.repo}/` : ""}${selected.path}`
		: null;
	useEffect(() => {
		if (!selectedPath || !paths.includes(selectedPath)) return;
		model.scrollToPath(selectedPath, { focus: false });
	}, [model, selectedPath, paths]);

	return (
		<div
			className="flex min-h-0 flex-1 flex-col"
			data-testid={`run-files-tree-${mode}`}
		>
			{mode === "all" && all.some((q) => q.isLoading) && (
				<p className="px-3 text-meta text-text-3">Listing files</p>
			)}
			{mode === "all" && failed && (
				<p className="px-3 text-meta text-text-2" data-testid="files-failed">
					The files at this commit could not be listed. Files the run touched
					are under Touched.
				</p>
			)}
			{truncated && (
				<p className="px-3 text-meta text-text-3">
					Showing the first 20,000 files.
				</p>
			)}
			<div ref={host} className="min-h-0 flex-1" style={TREE_STYLE}>
				<FileTree model={model} style={{ height: "100%" }} />
			</div>
		</div>
	);
}
