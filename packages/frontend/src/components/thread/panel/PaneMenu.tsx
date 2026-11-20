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
	Server,
	Siren,
	SquareTerminal,
} from "lucide-react";
import type { ReactNode } from "react";
import { SurfaceMore } from "@/components/kit/Surface";
import type { AppCtx } from "@/components/shell/app.actions";
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
 * The panes a thread can open (#1101 category 21), from the registry (#1127): one row
 * per tool that works here, by its app key. A tool that cannot work here is absent; the
 * New tab page says why. Tiling is on a tab's menu and the New tab page.
 */
export function PaneMenu({
	tools,
	trigger,
	side = "bottom",
	open,
}: {
	tools: PaneTool[];
	trigger: ReactNode;
	side?: "top" | "bottom";
	/** Held open, for the gallery. */
	open?: boolean;
}) {
	const works = (id: PaneTool["id"]) =>
		tools.some((t) => t.id === id && !t.unavailable);
	const ctx: AppCtx = {
		facts: {
			is: {
				paneDetails: works("thread"),
				paneChanges: works("changes"),
				paneFiles: works("files"),
				paneBrowser: works("browser"),
				terminal: works("terminal"),
				paneKind: works("kind"),
			},
		},
	};
	return (
		<SurfaceMore
			id="pane.open"
			ctx={ctx}
			trigger={trigger}
			side={side}
			open={open}
		/>
	);
}

export const tileableTool = (t: PaneTool) =>
	t.id !== "terminal" && !t.unavailable && PANE_VIEW[t.id].tile;
