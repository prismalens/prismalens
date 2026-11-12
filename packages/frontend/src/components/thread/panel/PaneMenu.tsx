// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LucideIcon } from "lucide-react";
import {
	Columns2,
	FileCode2,
	FolderTree,
	Globe,
	ListTree,
	SquareTerminal,
} from "lucide-react";
import type { ReactNode } from "react";
import { Help, Menu, type MenuEntry } from "@/components/kit";
import type { PanelId } from "./panel-model";

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
	kind: ListTree,
	thread: ListTree,
	changes: FileCode2,
	files: FolderTree,
	browser: Globe,
	terminal: SquareTerminal,
};

/** Alt+digit opens a pane; the digit follows the pane menu's order. */
export function paneKeyOf(
	e: KeyboardEvent,
	tools: PaneTool[],
): PaneTool | null {
	if (!e.altKey || e.ctrlKey || e.metaKey || !/^Digit[1-9]$/.test(e.code))
		return null;
	const n = Number(e.code.slice(5));
	return tools.find((t) => t.keys.at(-1) === String(n)) ?? null;
}

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
	const tileable = tools.filter((t) => t.id !== "terminal" && !t.unavailable);
	const entries: MenuEntry[] = [
		...tools.map((t) => ({
			id: `open-${t.id}`,
			label: t.label,
			icon: ICON[t.id],
			onSelect: () => onOpen(t.id),
		})),
		...(onTile && tileable.length
			? [
					{ id: "tile-sep", separator: true as const },
					...tileable.map((t) => ({
						id: `tile-${t.id}`,
						label: `${t.label} below`,
						icon: Columns2,
						onSelect: () => onTile(t.id),
					})),
				]
			: []),
	];
	return (
		<Menu label="Open a pane" entries={entries} trigger={trigger} side={side} />
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
