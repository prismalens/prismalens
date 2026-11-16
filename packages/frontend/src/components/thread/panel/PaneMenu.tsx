// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LucideIcon } from "lucide-react";
import {
	FileCode2,
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
import type { ReactNode } from "react";
import { Menu, type MenuEntry } from "@/components/kit/Menu";
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

export const tileableTool = (t: PaneTool) =>
	t.id !== "terminal" && !t.unavailable && PANE_VIEW[t.id].tile;
