// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The subset of Rolldown's chunking context this plan reads. */
interface Graph {
	getModuleInfo(id: string): {
		isEntry: boolean;
		importers: readonly string[];
		dynamicImporters: readonly string[];
		importedIds: readonly string[];
	} | null;
}

/** A route whose component and everything it imports statically load as one file. */
export interface PageChunk {
	/** `shell` joins the entry's file: the layout every page renders. */
	name: string;
	/** The route's split component module, e.g. `threads/$id.tsx?tsr-split=component`. */
	root: RegExp;
}

/**
 * Names the modules the entry (and the `shell` roots) reach through static imports `shell`,
 * those only one listed page reaches that page's name, and those two pages share `pages`,
 * so a first paint loads a few files rather than a hundred (#1101 category 12): over a
 * 400 ms round trip each file costs a request. Lazy parts keep their own chunks, and no
 * module is copied into two chunks.
 */
export function firstPaintChunks(pages: readonly PageChunk[]) {
	const plan = namer(pages);
	// A group takes its modules' static imports along, so the shell claims first, then what
	// pages share, then each page: none drags another's modules into its file.
	const only =
		(pick: (name: string) => boolean) =>
		(id: string, graph: Graph): string | null => {
			const n = plan(id, graph);
			return n !== null && pick(n) ? n : null;
		};
	return [
		{ name: only((n) => n === "shell"), priority: 3 },
		{ name: only((n) => n === "pages"), priority: 2 },
		{ name: only((n) => n !== "shell" && n !== "pages"), priority: 1 },
	];
}

function namer(pages: readonly PageChunk[]) {
	const reach = new Map<string, Set<string>>();
	const expanded = new Set<string>();
	const seen = new Set<string>();
	// From a root, note `name` on every module it imports statically.
	const expand = (root: string, name: string, graph: Graph) => {
		const key = `${name}\0${root}`;
		if (expanded.has(key)) return;
		expanded.add(key);
		const queue = [root];
		for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
			const names = reach.get(id) ?? new Set<string>();
			if (names.has(name)) continue;
			names.add(name);
			reach.set(id, names);
			queue.push(...(graph.getModuleInfo(id)?.importedIds ?? []));
		}
	};
	// Up from a module through every importer, to the entries and roots above it.
	const findRoots = (from: string, graph: Graph) => {
		const queue = [from];
		for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
			if (seen.has(id)) continue;
			seen.add(id);
			const info = graph.getModuleInfo(id);
			if (!info) continue;
			if (info.isEntry) expand(id, "shell", graph);
			for (const p of pages) if (p.root.test(id)) expand(id, p.name, graph);
			queue.push(...info.importers, ...info.dynamicImporters);
		}
	};
	return (id: string, graph: Graph): string | null => {
		if (!seen.has(id)) findRoots(id, graph);
		// The entry keeps its own small file, so its budget still reads our startup code.
		if (graph.getModuleInfo(id)?.isEntry) return null;
		const names = reach.get(id);
		if (!names) return null;
		if (names.has("shell")) return "shell";
		return names.size === 1 ? (names.values().next().value ?? null) : "pages";
	};
}
