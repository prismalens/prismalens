// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Columns2,
	FileCode2,
	FolderTree,
	Globe,
	ListTree,
	SquareTerminal,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Keys } from "@/components/shared/Hint";
import { cn } from "@/lib/utils";
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

const ICON: Record<PaneTool["id"], ComponentType<{ className?: string }>> = {
	kind: ListTree,
	thread: ListTree,
	changes: FileCode2,
	files: FolderTree,
	browser: Globe,
	terminal: SquareTerminal,
	new: Columns2,
};

/** Alt+digit opens a pane; the digit follows the New tab page's order. */
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
 * The New tab page (#1101 category 21): every tool the panel can open, with its key.
 * A tool that cannot open here says why and what to do instead of hiding.
 */
export function NewTabPage({
	tools,
	onOpen,
	onTile,
}: {
	tools: PaneTool[];
	onOpen: (id: PaneTool["id"]) => void;
	/** Opens the tool tiled under the current pane. */
	onTile?: (id: PaneTool["id"]) => void;
}) {
	return (
		<div
			className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pt-3 pb-5"
			data-testid="new-tab-page"
		>
			<h3 className="px-2 pb-1 text-meta text-text-3">Open in this thread</h3>
			<ul className="m-0 flex list-none flex-col gap-0.5 p-0">
				{tools.map((t) => {
					const Icon = ICON[t.id];
					const off = !!t.unavailable;
					return (
						<li key={t.id} data-testid={`new-tab-${t.id}`}>
							<div
								className={cn(
									"flex items-start gap-2.5 rounded-control px-2 py-2",
									!off && "hover:bg-surface-3",
								)}
							>
								<Icon className="mt-0.5 size-4 shrink-0 text-text-2" />
								<div className="min-w-0 flex-1">
									<button
										type="button"
										disabled={off}
										onClick={() => onOpen(t.id)}
										className="w-full text-left text-body text-text-1 disabled:text-text-2"
										data-testid={`new-tab-open-${t.id}`}
									>
										{t.label}
										<span className="block text-meta text-text-3">
											{t.detail}
										</span>
									</button>
									{t.unavailable && (
										<p
											className="mt-1 text-meta text-text-2"
											data-testid={`new-tab-unavailable-${t.id}`}
										>
											{t.unavailable.why} {t.unavailable.next}
											{t.unavailable.action && (
												<span className="mt-1 block">
													{t.unavailable.action}
												</span>
											)}
										</p>
									)}
								</div>
								<div className="flex shrink-0 items-center gap-1.5 pt-0.5">
									{onTile && !off && t.id !== "terminal" && (
										<button
											type="button"
											onClick={() => onTile(t.id)}
											className="h-6 rounded-[4px] px-1.5 text-meta text-text-2 hover:bg-surface-2 hover:text-text-1"
											aria-label={`Tile ${t.label} below`}
											data-testid={`new-tab-tile-${t.id}`}
										>
											Tile
										</button>
									)}
									<Keys keys={t.keys} />
								</div>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

/** A pane that cannot work here: why, and the next step (#1101 category 21). */
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
			<div className="max-w-[31rem]">
				<h3 className="mb-1.5 font-semibold text-body text-text-1">{title}</h3>
				<p className="mb-2.5 text-body text-text-2 leading-relaxed">{why}</p>
				{action}
			</div>
		</div>
	);
}
