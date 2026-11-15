// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronRight, PanelRight } from "lucide-react";
import {
	Fragment,
	type ReactElement,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
	type BoxSlot,
	boxHeight,
	CARD_W,
	type Density,
	type DetailsRow,
	dockFor,
	ROW_H,
	slotRows,
	visibleRows,
} from "./details";
import { KitPopover } from "./Popover";

const TONE = {
	danger: "text-danger",
	warn: "text-warn",
	accent: "text-accent",
	"sev-high": "text-sev-high",
	"sev-low": "text-sev-low",
	ok: "text-ok",
} as const;

const ICON_BTN =
	"flex size-7 items-center justify-center rounded-control text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-3";

function Row({ row }: { row: DetailsRow }) {
	const el = RowBody({ row });
	return row.wrap ? row.wrap(el) : el;
}

function RowBody({ row }: { row: DetailsRow }) {
	if (row.control)
		return (
			<div className="flex min-w-0 flex-col" data-testid={`details-${row.id}`}>
				{row.control}
			</div>
		);
	const body = (
		<>
			<span
				className={cn(
					"flex h-5 w-3.5 shrink-0 items-center justify-center",
					row.tone ? TONE[row.tone] : "text-text-3",
				)}
			>
				{row.mark ??
					(row.icon && (
						<row.icon aria-hidden className="size-3.5 stroke-[1.75]" />
					))}
			</span>
			<span
				className={cn(
					"min-w-0 flex-1 text-text-1",
					row.lines === 2 ? "line-clamp-2" : "truncate",
					row.mono && "font-mono text-mono leading-5",
					row.quiet && "text-text-3",
				)}
			>
				{row.label}
			</span>
			{row.value !== undefined && (
				<span className="shrink-0 text-body">{row.value}</span>
			)}
			{row.onOpen && (
				<ChevronRight
					aria-hidden
					className="size-3.5 shrink-0 self-center text-text-3"
				/>
			)}
		</>
	);
	const cls = cn(
		"flex w-full min-w-0 gap-2 rounded-control px-2 text-left text-body",
		row.lines === 2 ? "min-h-11 items-start py-1" : "h-7 items-center",
	);
	return row.onOpen ? (
		<button
			type="button"
			className={cn(
				cls,
				"outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent",
			)}
			onClick={row.onOpen}
			data-testid={`details-${row.id}`}
		>
			{body}
		</button>
	) : (
		<div
			className={cls}
			data-testid={`details-${row.id}`}
			data-quiet={row.quiet || undefined}
		>
			{body}
		</div>
	);
}

/** The rows at one density, grouped, with a hairline between groups. */
export function DetailsCard({
	rows,
	density = "full",
	className,
	layout,
	height,
	fit,
}: {
	rows: DetailsRow[];
	density?: Density;
	className?: string;
	/** The box's fixed slots: each keeps its height whatever it holds (#1101 category 21 item 6). */
	layout?: readonly BoxSlot[];
	height?: number;
	fit?: boolean;
}) {
	if (layout)
		return (
			<SlotCard
				rows={rows}
				layout={layout}
				className={className}
				height={height}
				fit={fit}
			/>
		);
	const shown = visibleRows(rows, density);
	const groups = shown
		.map((r) => r.group)
		.filter((g, i, all) => all.indexOf(g) === i);
	return (
		<section
			aria-label="Details"
			className={cn("flex flex-col rounded-pool bg-surface-1 p-1.5", className)}
			data-testid="details-card"
			data-density={density}
		>
			{groups.map((g, i) => (
				<Fragment key={g}>
					{i > 0 && <div className="mx-2 my-1 h-px bg-hairline" />}
					{shown
						.filter((r) => r.group === g)
						.map((r) => (
							<Row key={r.id} row={r} />
						))}
				</Fragment>
			))}
		</section>
	);
}

function SlotCard({
	rows,
	layout,
	className,
	height,
	fit = false,
}: {
	rows: DetailsRow[] | null;
	layout: readonly BoxSlot[];
	className?: string;
	/** One height for every kind's box, so moving between threads never resizes it. */
	height?: number;
	/** Off the wide page (a phone's popover) slots may grow, so touch-sized controls never clip. */
	fit?: boolean;
}) {
	return (
		<section
			aria-label="Details"
			className={cn(
				"flex flex-col overflow-hidden rounded-pool bg-surface-1 p-1.5",
				className,
			)}
			style={fit ? undefined : { height: height ?? boxHeight(layout) }}
			data-testid="details-card"
			data-density="slots"
			aria-busy={rows ? undefined : true}
		>
			{layout.map((slot, i) => {
				const kept = rows ? slotRows(rows, slot) : null;
				return (
					<Fragment key={slot.id}>
						{i > 0 && (
							// Only above a slot with rows: a blank slot keeps its height without a rule.
							<div
								className={cn(
									"mx-2 my-1 h-px shrink-0",
									(kept === null || kept.length > 0) && "bg-hairline",
								)}
							/>
						)}
						<div
							className={cn(
								"flex shrink-0 flex-col",
								!fit && "overflow-hidden",
							)}
							style={
								fit
									? { minHeight: kept?.length ? undefined : 0 }
									: { height: slot.rows * ROW_H }
							}
							data-slot={slot.id}
						>
							{kept
								? kept.map((r) => <Row key={r.id} row={r} />)
								: Array.from(
										{ length: slot.rows },
										(_, n) => `${slot.id}.${n}`,
									).map((k) => (
										<div key={k} className="flex h-7 items-center px-2">
											<Skeleton className="h-3 w-3/4" />
										</div>
									))}
						</div>
					</Fragment>
				);
			})}
		</section>
	);
}

function useBox() {
	const ref = useRef<HTMLDivElement>(null);
	const [box, setBox] = useState({ w: 0, h: 0 });
	useEffect(() => {
		const el = ref.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(([e]) =>
			setBox({ w: e.contentRect.width, h: e.contentRect.height }),
		);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	return { ref, box };
}

/**
 * The thread page's right side: the box docked top-right beside the transcript, at one
 * place and size on every thread (#1101 category 21 item 6). Too narrow to sit beside the
 * transcript, it becomes a button; `off` gives the column alone while a pane is open.
 */
export function DetailsDock({
	rows,
	layout,
	height,
	off = false,
	children,
	className,
	wrapCard = (card) => card,
}: {
	/** Null while the thread's facts load: the box shows its slots as placeholders. */
	rows: DetailsRow[] | null;
	layout: readonly BoxSlot[];
	height?: number;
	/**
	 * No box and no button, the column alone: the caller keeps the dock while it hides, so its
	 * column never remounts when a pane opens (#1130).
	 */
	off?: boolean;
	/** Puts the card inside its caller's registered surface (#1125). */
	wrapCard?: (card: ReactElement) => ReactElement;
	/** The transcript column. */
	children: ReactNode;
	className?: string;
}) {
	const { ref, box } = useBox();
	const fits = box.w ? dockFor(box.w) === "docked" : true;
	const mode = off ? "off" : !fits ? "button" : "docked";
	return (
		<div
			ref={ref}
			className={cn(
				"relative flex h-full min-w-0",
				!off && ["gap-4", className],
			)}
			data-testid={off ? undefined : "details-dock"}
			data-dock={off ? undefined : mode}
		>
			<div className="min-w-0 flex-1">{children}</div>
			{mode === "docked" && (
				<div className="relative shrink-0 pt-2" style={{ width: CARD_W }}>
					{rows ? (
						wrapCard(<SlotCard rows={rows} layout={layout} height={height} />)
					) : (
						<SlotCard rows={null} layout={layout} height={height} />
					)}
				</div>
			)}
			{mode === "button" && rows && (
				<div className="absolute top-2 right-2">
					<KitPopover
						family="picker"
						align="end"
						label="Details"
						hint="Details"
						trigger={
							<button
								type="button"
								aria-label="Details"
								data-testid="details-button"
								className={ICON_BTN}
							>
								<PanelRight className="size-3.5" />
							</button>
						}
					>
						{wrapCard(
							<SlotCard
								rows={rows}
								layout={layout}
								className="bg-transparent p-0"
							/>,
						)}
					</KitPopover>
				</div>
			)}
		</div>
	);
}
