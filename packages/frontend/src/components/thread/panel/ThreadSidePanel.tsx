// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Plus, X } from "lucide-react";
import {
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	useRef,
} from "react";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PanelId, PanelTab } from "./panel-model";

/**
 * The one right panel for every kind of thread (#1024): the kind tab, Thread and
 * Changes, plus Browser once a page was opened. One tab left hides the strip.
 */
export function ThreadSidePanel({
	tabs,
	tab,
	onTab,
	onClose,
	content,
	override,
	overrideLabel,
	closeTestId = "thread-panel-close",
	onNewTab,
	split,
}: {
	/** Opens the New tab page (#1101 category 21). */
	onNewTab?: () => void;
	/** A second pane tiled under the shown one; it belongs to the thread. */
	split?: {
		label: string;
		content: ReactNode;
		onClose: () => void;
		/** The top pane's share of the height. */
		ratio: number;
		onRatio: (r: number) => void;
	};
	/** The run page keeps its own close test id. */
	closeTestId?: string;
	tabs: PanelTab[];
	tab: PanelId | null;
	onTab: (id: PanelId) => void;
	onClose: () => void;
	/** The shown tab's body. */
	content: ReactNode;
	/** A view in place of the tabs, e.g. one sub-agent's (#1025). */
	override?: ReactNode;
	overrideLabel?: string;
}) {
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key !== "Escape" || e.defaultPrevented) return;
		e.stopPropagation();
		onClose();
	};
	const strip = !override && (tabs.length > 1 || !!onNewTab);
	const body = useRef<HTMLDivElement>(null);
	// The divider drags the split; arrows move it by a tenth.
	const drag = (e: PointerEvent<HTMLDivElement>) => {
		const box = body.current?.getBoundingClientRect();
		if (!split || !box) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		const move = (ev: globalThis.PointerEvent) =>
			split.onRatio(
				Math.min(0.8, Math.max(0.2, (ev.clientY - box.top) / box.height)),
			);
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};
	// The tabs pattern: arrows, Home and End move between tabs; only the shown tab is in the Tab order.
	const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
		const at = tabs.findIndex((t) => t.id === tab);
		const arrow = e.key.startsWith("Arrow") ? e.key.slice(5) : null;
		const to =
			arrow === "Right"
				? (at + 1) % tabs.length
				: arrow === "Left"
					? (at - 1 + tabs.length) % tabs.length
					: e.key === "Home"
						? 0
						: e.key === "End"
							? tabs.length - 1
							: -1;
		const next = tabs[to];
		if (!next) return;
		e.preventDefault();
		onTab(next.id);
		document.getElementById(`panel-tab-${next.id}`)?.focus();
	};
	return (
		<div
			id="thread-panel"
			onKeyDown={onKeyDown}
			className="flex h-full min-h-0 flex-col"
			data-testid="thread-panel"
		>
			<div
				data-title-row
				className="flex h-(--header-h) shrink-0 items-center gap-1 px-2 shadow-[0_1px_0_var(--hairline)]"
			>
				{strip ? (
					<div
						role="tablist"
						aria-label="Panel"
						onKeyDown={onTabKey}
						data-scroll-x
						className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
					>
						{tabs.map((t) => (
							<button
								key={t.id}
								type="button"
								role="tab"
								id={`panel-tab-${t.id}`}
								aria-controls="panel-body"
								aria-selected={tab === t.id}
								tabIndex={tab === t.id ? 0 : -1}
								onClick={() => onTab(t.id)}
								className={cn(
									"h-7 rounded-control px-2 text-body transition-colors duration-(--dur-instant) hover:bg-surface-3",
									tab === t.id ? "bg-surface-3 text-text-1" : "text-text-2",
								)}
								aria-label={
									t.flagged
										? `${t.label}, ${t.flagged} flagged ${t.flagged === 1 ? "item" : "items"}`
										: undefined
								}
								data-testid={`panel-tab-${t.id}`}
							>
								{t.label}
								{!!t.flagged && (
									<span
										aria-hidden
										className="ml-1 inline-block size-1.5 rounded-full bg-danger align-middle"
									/>
								)}
							</button>
						))}
						{onNewTab && (
							<Hint label="New tab">
								<button
									type="button"
									aria-label="New tab"
									onClick={onNewTab}
									className="grid size-7 shrink-0 place-items-center rounded-control text-text-3 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1"
									data-testid="panel-new-tab"
								>
									<Plus className="size-3.5" />
								</button>
							</Hint>
						)}
					</div>
				) : (
					<h2 className="min-w-0 flex-1 truncate px-1 text-heading">
						{override ? overrideLabel : tabs[0]?.label}
					</h2>
				)}
				<Button
					variant="text"
					size="icon"
					aria-label="Close panel"
					onClick={onClose}
					className="text-text-3"
					data-testid={closeTestId}
				>
					<X className="size-3.5" />
				</Button>
			</div>
			{strip ? (
				<div ref={body} className="flex min-h-0 flex-1 flex-col">
					<div
						id="panel-body"
						role="tabpanel"
						aria-labelledby={tab ? `panel-tab-${tab}` : undefined}
						className="flex min-h-0 flex-col"
						style={{ flex: split ? `${split.ratio} 1 0` : "1 1 0" }}
						data-testid="panel-body"
						data-tab={tab ?? undefined}
					>
						{content}
					</div>
					{split && (
						<>
							<div
								role="separator"
								aria-orientation="horizontal"
								aria-label="Resize panes"
								aria-valuemin={20}
								aria-valuemax={80}
								aria-valuenow={Math.round(split.ratio * 100)}
								tabIndex={0}
								onPointerDown={drag}
								onKeyDown={(e) => {
									const step =
										e.key === "ArrowUp"
											? -0.1
											: e.key === "ArrowDown"
												? 0.1
												: 0;
									if (!step) return;
									e.preventDefault();
									split.onRatio(
										Math.min(0.8, Math.max(0.2, split.ratio + step)),
									);
								}}
								className="h-1.5 shrink-0 cursor-row-resize shadow-[0_1px_0_var(--hairline)] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
								data-testid="panel-split-handle"
							/>
							<section
								aria-label={split.label}
								className="flex min-h-0 flex-col"
								style={{ flex: `${1 - split.ratio} 1 0` }}
								data-testid="panel-split"
							>
								<div className="flex h-8 shrink-0 items-center gap-1 px-2">
									<h3 className="min-w-0 flex-1 truncate px-1 text-meta text-text-2">
										{split.label}
									</h3>
									<Button
										variant="text"
										size="icon"
										aria-label={`Close ${split.label}`}
										onClick={split.onClose}
										className="text-text-3"
										data-testid="panel-split-close"
									>
										<X className="size-3.5" />
									</Button>
								</div>
								{split.content}
							</section>
						</>
					)}
				</div>
			) : (
				<section
					id="panel-body"
					aria-label={override ? overrideLabel : tabs[0]?.label}
					className="flex min-h-0 flex-1 flex-col"
					data-testid="panel-body"
					data-tab={override ? "override" : (tab ?? undefined)}
				>
					{override ?? content}
				</section>
			)}
		</div>
	);
}

/** A scrolling stack of sections: the kind and Thread tabs. */
export function PanelStack({ children }: { children: ReactNode }) {
	return (
		<div
			className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pt-3 pb-5"
			data-testid="panel-stack"
		>
			{children}
		</div>
	);
}
