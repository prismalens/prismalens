// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { FileTree, useFileTree } from "@pierre/trees/react";
import {
	type CSSProperties,
	type SyntheticEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { Surface } from "@/components/kit/Surface";
import { fileFlags, RISK_WORD } from "@/lib/turn-review";
import { type DiffTreeProps, OPEN_TREE_MAX_FILES } from "./DiffTreeStandIn";

const TREE_STYLE = {
	"--trees-fg-override": "var(--text-2)",
	"--trees-selected-bg-override": "var(--surface-3)",
	"--trees-border-color-override": "transparent",
	"--trees-bg-override": "transparent",
	"--trees-font-family-override": "var(--font-sans)",
	"--trees-input-bg-override": "var(--surface-2)",
	"--trees-search-bg-override": "var(--surface-2)",
	"--trees-search-fg-override": "var(--text-1)",
} as CSSProperties;

// The tree marks its list while scrolling and sets pointer-events on it; that inherited change
// restyles every rendered row on each wheel event, so the list keeps its value (#1101 cat 16).
// Counts never shrink, and a joined folder chain gives up its leading names before its last one.
const TREE_CSS =
	'[data-type="item"]{contain:size layout style}[data-file-tree-virtualized-list="true"][data-is-scrolling][data-is-scrolling]{pointer-events:auto}[data-file-tree-virtualized-scroll="true"]{will-change:scroll-position}' +
	'[data-item-section="decoration"]{flex:0 0 auto;padding-left:6px}[data-item-section="decoration"]>span{overflow:visible}' +
	"[data-item-flattened-subitems]{min-width:0;max-width:100%;overflow:hidden}[data-item-flattened-subitem]{min-width:0;flex:0 1 auto}[data-item-flattened-subitem]:not(:last-child){flex-shrink:1000}";

type RowDecoration = ReturnType<
	NonNullable<Parameters<typeof useFileTree>[0]["renderRowDecoration"]>
>;

export function DiffTree({
	files,
	outside,
	selected,
	onPick,
	rowCtx,
}: DiffTreeProps) {
	const [menuAt, setMenuAt] = useState<string | null>(null);
	const byPath = useRef(new Map(files.map((f) => [f.path, f])));
	byPath.current = new Map(files.map((f) => [f.path, f]));
	const out = useRef(outside);
	out.current = outside;
	const pick = useRef(onPick);
	pick.current = onPick;
	// A row the user picked here is already in view: scrolling to it again costs a full tree pass.
	const pickedHere = useRef<string | null>(null);
	// Each row's marks, made once per answer: a scroll renders rows, never re-derives them (#1101 cat 16).
	const decor = useRef(new Map<string, RowDecoration>());
	const decorFor = useRef<[typeof files, Set<string>] | null>(null);
	if (decorFor.current?.[0] !== files || decorFor.current?.[1] !== outside) {
		decor.current = new Map();
		decorFor.current = [files, outside];
	}
	const paths = files.map((f) => f.path);
	const { model } = useFileTree({
		paths,
		initialExpansion: files.length > OPEN_TREE_MAX_FILES ? 2 : "open",
		flattenEmptyDirectories: true,
		search: true,
		density: "compact",
		// Fewer rows built per scroll step: a 900-file tree on a slow CPU stays under one frame budget.
		overscan: 4,
		stickyFolders: false,
		unsafeCSS: TREE_CSS,
		renderRowDecoration: ({ item }) => {
			if (!decor.current.has(item.path))
				decor.current.set(item.path, rowDecoration(item.path));
			return decor.current.get(item.path) ?? null;
		},
		onSelectionChange: (selection) => {
			const p = selection[0];
			if (p && !p.endsWith("/") && byPath.current.has(p)) {
				pickedHere.current = p;
				pick.current(p);
			}
		},
	});
	function rowDecoration(path: string): RowDecoration {
		const f = byPath.current.get(path);
		if (!f) return null;
		const isOut = out.current.has(f.path);
		const flags = fileFlags({
			path: f.path,
			add: f.additions ?? 0,
			del: f.deletions ?? 0,
			status: f.status,
		});
		const flagPart = flags.length
			? [{ text: "⚑  ", color: "var(--warn)" }]
			: [];
		const flagWords = flags.length
			? `${flags.map((x) => RISK_WORD[x]).join(", ")}. `
			: "";
		// The tree lays parts out as flex items, which drop plain spaces: NBSPs keep them apart.
		const outPart = isOut
			? [{ text: "outside  ", color: "var(--text-3)" }]
			: [];
		if (f.additions === null)
			return {
				text: `${isOut ? "outside  " : ""}${f.status === "link" ? "not captured" : f.status}`,
				title:
					f.status === "link" ? "A link or special file: never read" : f.status,
			};
		return {
			text: `${isOut ? "outside  " : ""}+${f.additions} −${f.deletions ?? 0}`,
			title: `${flagWords}${isOut ? "Changed between or after the agent's turns. " : ""}${f.additions} added, ${f.deletions ?? 0} removed`,
			parts: [
				...flagPart,
				...outPart,
				{ text: `+${f.additions}`, color: "var(--ok)" },
				{ text: ` −${f.deletions ?? 0}`, color: "var(--danger)" },
			],
		};
	}
	const key = paths.join("\0");
	const _markKey =
		files.map((f) => `${f.additions}:${f.deletions}`).join(",") +
		Array.from(outside).join(",");
	useEffect(() => {
		model.resetPaths(key ? key.split("\0") : []);
	}, [model, key]);
	useEffect(() => {
		if (selected && selected !== pickedHere.current)
			model.scrollToPath(selected, { focus: false });
	}, [model, selected]);
	const host = useRef<HTMLDivElement>(null);
	// The tree renders `role=tree` in an open shadow root with no label (#973 OBJ-010).
	useEffect(() => {
		const name = () => {
			const tree = host.current
				?.querySelector("*")
				?.shadowRoot?.querySelector("[role=tree]");
			tree?.setAttribute("aria-label", "Changed files");
			return !!tree;
		};
		if (name()) return;
		const t = window.setInterval(() => {
			if (name()) window.clearInterval(t);
		}, 50);
		return () => window.clearInterval(t);
	}, []);
	// Right-click, Shift+F10 and the Menu key name the row first; a folder or empty space keeps the browser's menu.
	const onMenu = (e: SyntheticEvent) => {
		// The menu's own anchor re-fires contextmenu from outside the tree: let it through.
		if (!host.current?.contains(e.target as Node)) return;
		const p = treeRowPath(e, host.current);
		if (!p || !byPath.current.has(p)) {
			e.stopPropagation();
			return;
		}
		setMenuAt(p);
	};
	return (
		<div
			className="contents"
			onContextMenuCapture={onMenu}
			data-testid="diff-files-menu"
		>
			<Surface id="diff.tree" ctx={rowCtx(menuAt ?? files[0]?.path ?? "")}>
				<div
					ref={host}
					className="min-h-0 flex-1 contain-strict"
					style={TREE_STYLE}
					data-testid="diff-files"
				>
					<FileTree model={model} style={{ height: "100%" }} />
				</div>
			</Surface>
		</div>
	);
}

/** The row a right-click or Shift+F10 landed on, through the tree's open shadow root. */
function treeRowPath(
	e: SyntheticEvent,
	host: HTMLElement | null,
): string | null {
	for (const el of e.nativeEvent.composedPath())
		if (el instanceof HTMLElement && el.dataset.itemPath)
			return el.dataset.itemPath;
	const active = host?.querySelector("*")?.shadowRoot?.activeElement;
	return active instanceof HTMLElement
		? (active.dataset.itemPath ?? null)
		: null;
}
