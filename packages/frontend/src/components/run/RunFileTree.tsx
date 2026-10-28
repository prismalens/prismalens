// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { FileTree, useFileTree } from "@pierre/trees/react";
import type { RunWorkspace } from "@prismalens/contracts";
import { useQueryClient } from "@tanstack/react-query";
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

type Repo = RunWorkspace["repos"][number];

/**
 * The Files tab's tree (#973), drawn by `@pierre/trees`: the files the run
 * touched, or every file at the recorded commit, one directory fetched at a
 * time as it opens. Picking a file opens it in the file view.
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
	const marks = useMemo(
		() => new Map(touched.map((t) => [t.path, t])),
		[touched],
	);
	const loaded = useRef(new Set<string>());
	const dirs = useRef(new Set<string>());
	const client = useQueryClient();
	const pick = useRef(onPick);
	pick.current = onPick;

	// Tree path -> repo and path inside it.
	const resolve = (p: string): { repo: Repo; path: string } | null => {
		const clean = p.replace(/\/$/, "");
		if (!many) {
			const repo = workspace.repos[0];
			return repo ? { repo, path: clean } : null;
		}
		const [name, ...rest] = clean.split("/");
		const repo = workspace.repos.find((r) => r.name === name);
		return repo ? { repo, path: rest.join("/") } : null;
	};

	const label =
		mode === "touched"
			? "Files this run touched"
			: `All files at ${workspace.repos[0]?.head.slice(0, 7) ?? ""}`;

	const { model } = useFileTree({
		paths:
			mode === "touched"
				? touched.map((t) => t.path)
				: many
					? workspace.repos.map((r) => `${r.name}/`)
					: [],
		initialExpansion: mode === "touched" ? "open" : "closed",
		flattenEmptyDirectories: true,
		search: mode === "all",
		density: "compact",
		renderRowDecoration: ({ item }) => {
			const mark = marks.get(item.path)?.mark;
			return mark ? { text: mark, title: `${mark} by this run` } : null;
		},
		onSelectionChange: (paths) => {
			const p = paths[0];
			if (!p) return;
			if (mode === "touched") {
				const hit = marks.get(p);
				if (hit) pick.current(hit.file);
				return;
			}
			const at = resolve(p);
			if (!at) return;
			if (dirs.current.has(p) || p.endsWith("/")) void expand(p);
			else
				pick.current({
					repo: at.repo.name,
					sha: at.repo.head,
					path: at.path,
					line: null,
					end: null,
				});
		},
	});

	// "All files": one directory per request, each added under its parent as it opens.
	async function expand(treePath: string) {
		const key = treePath.replace(/\/$/, "");
		if (loaded.current.has(key)) return;
		loaded.current.add(key);
		const at = resolve(key);
		if (!at) return;
		const tree = await client.fetchQuery({
			...orpc.investigations.getTree.queryOptions({
				input: {
					id: runId,
					sha: at.repo.head,
					...(at.path ? { prefix: at.path } : {}),
				},
			}),
			staleTime: Number.POSITIVE_INFINITY,
		});
		if (tree.state !== "ok") return;
		const base = many ? `${at.repo.name}/` : "";
		for (const e of tree.entries) {
			const p = `${base}${e.path}${e.type === "dir" ? "/" : ""}`;
			if (e.type === "dir") dirs.current.add(p.replace(/\/$/, ""));
			model.add(p);
		}
	}

	useEffect(() => {
		if (mode !== "all" || many) return;
		void expand("");
		// biome-ignore lint/correctness/useExhaustiveDependencies: the top level loads once per tree.
	}, [mode, many]);

	// Name the tree: it renders `role=tree` inside an open shadow root with no label (#973 OBJ-010).
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
		const root = host.current;
		if (!root) return;
		const watch = new MutationObserver(() => {
			if (name()) watch.disconnect();
		});
		watch.observe(root, { subtree: true, childList: true });
		const t = window.setInterval(() => {
			if (name()) window.clearInterval(t);
		}, 50);
		return () => {
			watch.disconnect();
			window.clearInterval(t);
		};
	}, [label]);

	const selectedPath = selected
		? `${many ? `${selected.repo}/` : ""}${selected.path}`
		: null;
	useEffect(() => {
		if (selectedPath) model.scrollToPath(selectedPath, { focus: false });
	}, [model, selectedPath]);

	return (
		<div
			ref={host}
			className="min-h-0 flex-1"
			style={TREE_STYLE}
			data-testid={`run-files-tree-${mode}`}
		>
			<FileTree model={model} style={{ height: "100%" }} />
		</div>
	);
}
