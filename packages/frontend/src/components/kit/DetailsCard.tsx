// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronRight, PanelRight, X } from "lucide-react";
import {
	Fragment,
	type ReactElement,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { Hint } from "@/components/shared/Hint";
import { cn } from "@/lib/utils";
import {
	CARD_W,
	type Density,
	type DetailsRow,
	densityFor,
	dockFor,
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
		<div className={cls} data-testid={`details-${row.id}`}>
			{body}
		</div>
	);
}

/** The rows at one density, grouped, with a hairline between groups. */
export function DetailsCard({
	rows,
	density = "full",
	className,
}: {
	rows: DetailsRow[];
	density?: Density;
	className?: string;
}) {
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
 * The thread page's right side: the card docked top-right beside the
 * transcript, its density set by the height it has. When docking would
 * squeeze the transcript under its minimum, or the user closed it, the card
 * becomes a button; the caller remembers `docked` (sheet §9.5).
 */
export function DetailsDock({
	rows,
	docked = true,
	onDockedChange,
	children,
	className,
	wrapCard = (card) => card,
}: {
	rows: DetailsRow[];
	/** Puts the card inside its caller's registered surface (#1125). */
	wrapCard?: (card: ReactElement) => ReactElement;
	docked?: boolean;
	onDockedChange?: (docked: boolean) => void;
	/** The transcript column. */
	children: ReactNode;
	className?: string;
}) {
	const { ref, box } = useBox();
	const fits = box.w ? dockFor(box.w) === "docked" : true;
	const density = box.h ? densityFor(box.h - 16, rows) : "full";
	const mode = !fits ? "button" : docked ? "docked" : "closed";
	return (
		<div
			ref={ref}
			className={cn("relative flex h-full min-w-0 gap-4", className)}
			data-testid="details-dock"
			data-dock={mode}
		>
			<div className="min-w-0 flex-1">{children}</div>
			{mode === "docked" && (
				<div
					className="group/dock relative shrink-0 pt-2"
					style={{ width: CARD_W }}
				>
					{wrapCard(<DetailsCard rows={rows} density={density} />)}
					{onDockedChange && (
						<div className="absolute top-3.5 right-1.5 rounded-control bg-surface-1 opacity-0 group-focus-within/dock:opacity-100 group-hover/dock:opacity-100">
							<Hint label="Close details">
								<button
									type="button"
									aria-label="Close details"
									className={ICON_BTN}
									onClick={() => onDockedChange(false)}
								>
									<X className="size-3.5" />
								</button>
							</Hint>
						</div>
					)}
				</div>
			)}
			{mode === "closed" && (
				<div className="absolute top-2 right-2">
					<Hint label="Show details">
						<button
							type="button"
							aria-label="Show details"
							data-testid="details-button"
							className={ICON_BTN}
							onClick={() => onDockedChange?.(true)}
						>
							<PanelRight className="size-3.5" />
						</button>
					</Hint>
				</div>
			)}
			{mode === "button" && (
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
							<DetailsCard rows={rows} className="bg-transparent p-0" />,
						)}
					</KitPopover>
				</div>
			)}
		</div>
	);
}
