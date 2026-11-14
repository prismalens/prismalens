// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Maximize2, Minimize2, Plus, X } from "lucide-react";
import {
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	useEffect,
	useRef,
} from "react";
import { Surface } from "@/components/kit/Surface";
import { TabPanel, Tabs } from "@/components/kit/Tabs";
import { Hint } from "@/components/shared/Hint";
import { useRightPanelWidth } from "@/components/shell/PanelShell";
import { Button } from "@/components/ui/button";
import type { PaneCtx } from "./pane.actions";
import {
	type PanelId,
	type PanelTab,
	paneWide,
	rememberPaneWide,
} from "./panel-model";

/**
 * The right panel when a pane is asked for (sheet §3): the open panes as kit
 * tabs, the pane menu and Close on their row. With none open the details card
 * shows instead (`kit/DetailsDock`).
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
	paneMenu,
	split,
	paneCtx,
	onNewTab,
}: {
	/** Opens the New tab page; the `+` at the tab row's end. */
	onNewTab?: () => void;
	/** Each tab's object for its context menu (`pane.tab`). */
	paneCtx?: (id: PanelId) => PaneCtx;
	/** The kit pane menu's trigger and menu, on the tab row. */
	paneMenu?: ReactNode;
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
	const body = useRef<HTMLDivElement>(null);
	const width = useRightPanelWidth();
	const shown = override ? null : tab;
	// Each pane opens at its own width: the diff wide, the rest narrow, until the user toggles it
	// there (#1101 category 16). Only a change of pane resizes, so a dragged width is kept.
	const widthNow = useRef(width);
	widthNow.current = width;
	useEffect(() => {
		const w = widthNow.current;
		if (shown && w.can) w.setWide(paneWide(shown));
	}, [shown]);
	const toggleWide = () => {
		if (shown) rememberPaneWide(shown, !width.wide);
		width.setWide(!width.wide);
	};
	const widen = width.can && (
		<Hint label={width.wide ? "Narrow the panel" : "Widen the panel"}>
			<Button
				variant="text"
				size="icon"
				aria-label={width.wide ? "Narrow the panel" : "Widen the panel"}
				aria-pressed={width.wide}
				onClick={toggleWide}
				className="text-text-3"
				data-testid="panel-widen"
			>
				{width.wide ? (
					<Minimize2 className="size-3.5" />
				) : (
					<Maximize2 className="size-3.5" />
				)}
			</Button>
		</Hint>
	);
	const newTab = onNewTab && tab !== "new" && (
		<Hint label="New tab">
			<Button
				variant="text"
				size="icon"
				aria-label="New tab"
				onClick={onNewTab}
				className="text-text-3"
				data-testid="panel-new-tab"
			>
				<Plus className="size-3.5" />
			</Button>
		</Hint>
	);
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
	const close = (
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
	);
	const splitView = split && (
		<>
			{/* biome-ignore lint/a11y/useSemanticElements: a focusable splitter takes the separator role; an hr cannot take focus or keys. */}
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
						e.key === "ArrowUp" ? -0.1 : e.key === "ArrowDown" ? 0.1 : 0;
					if (!step) return;
					e.preventDefault();
					split.onRatio(Math.min(0.8, Math.max(0.2, split.ratio + step)));
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
	);
	return (
		<div
			id="thread-panel"
			onKeyDown={onKeyDown}
			className="flex h-full min-h-0 flex-col pt-1"
			data-testid="thread-panel"
		>
			{override || !tab || tabs.length < 2 ? (
				<>
					<div className="flex h-9 shrink-0 items-center gap-1 px-2">
						<h2 className="min-w-0 flex-1 truncate px-1 text-heading">
							{override ? overrideLabel : tabs[0]?.label}
						</h2>
						{!override && newTab}
						{!override && paneMenu}
						{widen}
						{close}
					</div>
					<section
						id="panel-body"
						aria-label={override ? overrideLabel : tabs[0]?.label}
						className="flex min-h-0 flex-1 flex-col"
						data-testid="panel-body"
						data-tab={override ? "override" : (tab ?? undefined)}
					>
						{override ?? content}
					</section>
				</>
			) : (
				<Tabs
					fill
					label="Panes"
					value={tab}
					onValueChange={(v) => onTab(v as PanelId)}
					items={tabs.map((t) => ({
						value: t.id,
						label: t.label,
						testId: `panel-tab-${t.id}`,
						...(t.flagged ? { count: t.flagged } : {}),
					}))}
					wrap={
						paneCtx
							? (t, el) => (
									<Surface id="pane.tab" ctx={paneCtx(t.value as PanelId)}>
										{el}
									</Surface>
								)
							: undefined
					}
					trailing={
						<div className="flex shrink-0 items-center gap-0.5 pr-1">
							{newTab}
							{paneMenu}
							{widen}
							{close}
						</div>
					}
				>
					<TabPanel value={tab} fill>
						<div ref={body} className="flex min-h-0 flex-1 flex-col">
							<div
								id="panel-body"
								className="flex min-h-0 flex-col"
								style={{ flex: split ? `${split.ratio} 1 0` : "1 1 0" }}
								data-testid="panel-body"
								data-tab={tab}
							>
								{content}
							</div>
							{splitView}
						</div>
					</TabPanel>
				</Tabs>
			)}
		</div>
	);
}

/** A scrolling stack of sections: the kind and Details panes. */
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
