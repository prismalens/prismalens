// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useCallback, useEffect, useMemo, useState } from "react";
import { keyText } from "@/components/kit/menu-entries";
import { useAppCommand } from "@/lib/app-commands";
import { bindingOf } from "@/lib/shortcuts";
import { terminalStore } from "@/lib/terminal/store";
import { useTerminalAvailability } from "@/lib/terminal/use-terminal-availability";
import type { PaneTool } from "./PaneMenu";
import {
	type PaneLayout,
	type PanelId,
	type PanelTab,
	rememberedLayout,
	rememberLayout,
} from "./panel-model";

const TERMINAL_WHY = {
	"not-host": {
		why: "The terminal opens only on the host.",
		next: "Open PrismaLens on that machine, or use Copy on any command.",
	},
	"no-key": {
		why: "This browser has no terminal key.",
		next: "Run pl pair --operator on the host and open its link here.",
	},
	unsupported: {
		why: "The terminal module did not load here.",
		next: "Use Copy on any command instead.",
	},
} as const;

/** A tool's keys as the shortcut registry binds them now (`app.pane*`, `app.terminal`). */
const keysOf = (action: string) => keyText(bindingOf(action)).split("+");

/**
 * A thread's panes (#1101 category 21): the tools the New tab page lists, why each
 * cannot open here, their keys from the shortcut registry, and the layout that comes back with the thread.
 */
export function useThreadPanes(o: {
	threadId: string;
	tabs: PanelTab[];
	workspace: boolean;
	/** Kept for callers; the host browser opens in every app (#1061). */
	desktopBrowser?: boolean;
	onOpen: (id: PanelId) => void;
}) {
	const { threadId, tabs, workspace, onOpen } = o;
	const terminal = useTerminalAvailability();
	const [layout, setLayoutState] = useState<PaneLayout>(() =>
		rememberedLayout(threadId),
	);
	useEffect(() => setLayoutState(rememberedLayout(threadId)), [threadId]);
	const setLayout = useCallback(
		(next: (l: PaneLayout) => PaneLayout) =>
			setLayoutState((l) => {
				const out = next(l);
				rememberLayout(threadId, out);
				return out;
			}),
		[threadId],
	);
	const kind = tabs.find((t) => t.id === "kind");
	const tools = useMemo<PaneTool[]>(() => {
		const noCode = workspace
			? undefined
			: {
					why: "This thread has no code worktree.",
					next: "Start a thread from a project to get one.",
				};
		return [
			{
				id: "thread",
				label: "Details",
				detail: "Pull requests, child threads, steps",
				keys: keysOf("app.paneDetails"),
			},
			{
				id: "changes",
				label: "Changes",
				detail: "The diff, by turn or against base",
				keys: keysOf("app.paneChanges"),
				...(noCode ? { unavailable: noCode } : {}),
			},
			{
				id: "files",
				label: "Files",
				detail: "The worktree's files",
				keys: keysOf("app.paneFiles"),
				...(noCode ? { unavailable: noCode } : {}),
			},
			{
				id: "browser",
				label: "Browser",
				detail: "A browser you and the agent share",
				keys: keysOf("app.paneBrowser"),
			},
			{
				id: "terminal",
				label: "Terminal",
				detail: "A shell on the host, below the thread",
				keys: keysOf("app.terminal"),
				...(terminal && !terminal.available
					? { unavailable: TERMINAL_WHY[terminal.reason] }
					: {}),
			},
			...(kind
				? [
						{
							id: "kind" as const,
							label: kind.label,
							detail: "What this thread is about",
							keys: keysOf("app.paneKind"),
						},
					]
				: []),
		];
	}, [workspace, terminal, kind]);
	const open = useCallback(
		(id: PaneTool["id"]) => {
			if (id === "terminal") {
				terminalStore.requestOpen();
				return;
			}
			setLayout((l) =>
				l.opened.includes(id) ? l : { ...l, opened: [...l.opened, id] },
			);
			onOpen(id);
		},
		[onOpen, setLayout],
	);
	const can = (id: PaneTool["id"]) =>
		tools.some((t) => t.id === id && !t.unavailable);
	useAppCommand("paneDetails", () => open("thread"), can("thread"));
	useAppCommand("paneChanges", () => open("changes"), can("changes"));
	useAppCommand("paneFiles", () => open("files"), can("files"));
	useAppCommand("paneBrowser", () => open("browser"), can("browser"));
	useAppCommand("paneKind", () => open("kind"), can("kind"));
	return { tools, layout, setLayout, open };
}
