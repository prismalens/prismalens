// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LucideIcon } from "lucide-react";
import {
	FileCode2,
	FileSearch,
	FolderGit2,
	FolderTree,
	Globe,
	Layers,
	PanelRight,
	Plus,
	Rows2,
	Server,
	Siren,
	SquareTerminal,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Help } from "@/components/kit/Help";
import { Menu, type MenuEntry } from "@/components/kit/Menu";
import { Hint, Keys } from "@/components/shared/Hint";
import { Input } from "@/components/ui/input";
import { PANE_VIEW, type PanelId } from "./panel-model";

/** A tool the panel can open, and why it cannot here (#1101 category 21). */
export interface PaneTool {
	id: PanelId | "terminal";
	label: string;
	/** What it shows, in a few words. */
	detail: string;
	keys: string[];
	/** Set when the tool cannot open here: why, then what to do. */
	unavailable?: { why: string; next: string; action?: ReactNode };
}

const ICON: Record<PaneTool["id"], LucideIcon> = {
	kind: Layers,
	thread: PanelRight,
	changes: FileCode2,
	files: FolderTree,
	browser: Globe,
	terminal: SquareTerminal,
	new: Plus,
};

/** The kind pane is named by the thread's kind; each kind keeps its own icon. */
const KIND_ICON: Record<string, LucideIcon> = {
	project: FolderGit2,
	incident: Siren,
	service: Server,
};
export const iconOf = (t: PaneTool) =>
	t.id === "kind" ? (KIND_ICON[t.label.toLowerCase()] ?? Layers) : ICON[t.id];

/**
 * The panes a thread can open (#1101 category 21), on the kit menu (sheet §3):
 * one row per tool, then the same tools tiled below the shown pane. A tool that
 * cannot work here still opens, and its pane says why.
 */
export function PaneMenu({
	tools,
	onOpen,
	onTile,
	trigger,
	side = "bottom",
}: {
	tools: PaneTool[];
	onOpen: (id: PaneTool["id"]) => void;
	/** Opens the tool tiled under the shown pane; absent when no pane is shown. */
	onTile?: (id: PaneTool["id"]) => void;
	trigger: ReactNode;
	side?: "top" | "bottom";
}) {
	const tileable = tools.filter(tileableTool);
	const entries: MenuEntry[] = [
		...tools.map((t) => ({
			id: `open-${t.id}`,
			label: t.label,
			icon: iconOf(t),
			keys: t.keys.join("+"),
			onSelect: () => onOpen(t.id),
		})),
		...(onTile && tileable.length
			? [
					{ id: "tile-sep", separator: true as const },
					...tileable.map((t) => ({
						id: `tile-${t.id}`,
						label: `${t.label} below`,
						icon: Rows2,
						onSelect: () => onTile(t.id),
					})),
				]
			: []),
	];
	return (
		<Menu label="Open a pane" entries={entries} trigger={trigger} side={side} />
	);
}

const tileableTool = (t: PaneTool) =>
	t.id !== "terminal" && !t.unavailable && PANE_VIEW[t.id].tile;

/** `src/a.ts:42` or `src/a.ts#L42` → the path and its line. */
export function pathAt(text: string): { path: string; line?: number } | null {
	const m = /^\s*(?:\.\/)?([^:#\s][^:#]*?)(?:(?::|#L)(\d+))?\s*$/.exec(text);
	if (!m?.[1]) return null;
	return { path: m[1], ...(m[2] ? { line: Number(m[2]) } : {}) };
}

/**
 * The New tab page (#1101 category 21): every tool the panel can open with its key,
 * Tile below for each, and a path box that opens Files at a file and line.
 */
export function NewTabPage({
	tools,
	onOpen,
	onTile,
	onOpenPath,
}: {
	tools: PaneTool[];
	onOpen: (id: PaneTool["id"]) => void;
	onTile?: (id: PaneTool["id"]) => void;
	/** Absent when the thread has no worktree to read. */
	onOpenPath?: (at: { path: string; line?: number }) => void;
}) {
	const [path, setPath] = useState("");
	const at = pathAt(path);
	return (
		<div
			className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pt-2 pb-5"
			data-testid="new-tab-page"
		>
			<ul className="m-0 flex list-none flex-col p-0">
				{tools.map((t) => {
					const Icon = iconOf(t);
					return (
						<li
							key={t.id}
							className="group flex min-h-9 items-center gap-1 rounded-control hover:bg-surface-2"
							data-testid={`new-tab-${t.id}`}
						>
							<button
								type="button"
								onClick={() => onOpen(t.id)}
								aria-keyshortcuts={t.keys.join("+").replace("Ctrl", "Control")}
								className="flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-control px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
								data-testid={`new-tab-open-${t.id}`}
							>
								<Icon aria-hidden className="size-4 shrink-0 text-text-2" />
								<span className="shrink-0 text-body text-text-1">
									{t.label}
								</span>
								<span className="min-w-0 truncate text-meta text-text-3">
									{t.detail}
								</span>
							</button>
							{t.unavailable && (
								<Help
									about={t.label}
									text={t.unavailable.why}
									more={t.unavailable.next}
								/>
							)}
							{onTile && tileableTool(t) && (
								<Hint label={`Tile ${t.label} below`}>
									<button
										type="button"
										aria-label={`Tile ${t.label} below`}
										onClick={() => onTile(t.id)}
										className="grid size-7 shrink-0 place-items-center rounded-control text-text-3 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
										data-testid={`new-tab-tile-${t.id}`}
									>
										<Rows2 aria-hidden className="size-3.5" />
									</button>
								</Hint>
							)}
							<span className="pr-2">
								<Keys keys={t.keys} />
							</span>
						</li>
					);
				})}
			</ul>
			{onOpenPath && (
				<form
					className="flex items-center gap-2 px-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (at) onOpenPath(at);
					}}
				>
					<FileSearch aria-hidden className="size-4 shrink-0 text-text-2" />
					<Input
						value={path}
						onChange={(e) => setPath(e.target.value)}
						placeholder="Open a file: src/app.ts:42"
						aria-label="Open a file at a path and line"
						className="h-8 flex-1 font-mono text-mono"
						data-testid="new-tab-path"
					/>
				</form>
			)}
		</div>
	);
}

/** A pane that cannot work here: one short line, the why and next step behind `?` (sheet §0.3). */
export function PaneUnavailable({
	title,
	why,
	action,
	testId,
}: {
	title: string;
	why: string;
	action?: ReactNode;
	testId: string;
}) {
	return (
		<div className="grid flex-1 place-items-center p-6" data-testid={testId}>
			<div className="flex max-w-[31rem] flex-col items-center gap-2">
				<p className="flex items-center gap-1.5 text-body text-text-2">
					{title}
					<Help about={title} text={why} />
				</p>
				{action}
			</div>
		</div>
	);
}
