// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Command } from "cmdk";
import { Check, TriangleAlert } from "lucide-react";
import { type RefObject, useEffect, useRef } from "react";
import { Hint } from "@/components/shared/Hint";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import {
	OptionIcon,
	type PickerOption,
	type PickerRail,
	type PickerRailItem,
} from "./Picker";

/** Past this many rows the picker gets a search field. */
const SEARCH_FROM = 9;

/** A picker's searchable list: loaded when the picker first opens (#1101 category 12). */
export function PickerList({
	label,
	options,
	groups,
	values,
	actions,
	emptyText,
	searchPlaceholder,
	listTestId,
	pick,
	rail,
}: {
	label: string;
	options: PickerOption[];
	groups: string[];
	values: string[];
	actions?: PickerOption[];
	emptyText: string;
	searchPlaceholder?: string;
	listTestId?: string;
	pick: (o: PickerOption) => void;
	rail?: PickerRail;
}) {
	const root = useRef<HTMLDivElement>(null);
	const railRef = useRef<HTMLDivElement>(null);
	const searchable = !!rail || options.length >= SEARCH_FROM;
	// The list opens on its search, else on its list: the popover would focus a row's star (#1154).
	useEffect(() => {
		const el = root.current;
		if (!el || el.contains(document.activeElement)) return;
		(
			el.querySelector<HTMLElement>("[cmdk-input]") ??
			el.querySelector<HTMLElement>("[cmdk-list]")
		)?.focus();
	}, []);
	const list = (
		<Command
			// Each tile is its own list: its first row is highlighted and the search starts empty.
			key={rail?.value}
			ref={root}
			tabIndex={-1}
			loop
			label={label}
			className="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
			data-testid={listTestId}
			filter={(_, search, keywords) =>
				keywords?.some((k) => k.toLowerCase().includes(search.toLowerCase()))
					? 1
					: 0
			}
		>
			{searchable && (
				<>
					<Command.Input
						onKeyDown={(e) => {
							// Left at the start of the search goes back to the rail, as Right came from it.
							const at = e.currentTarget.selectionStart === 0;
							if (rail && e.key === "ArrowLeft" && at) {
								e.preventDefault();
								railRef.current
									?.querySelector<HTMLElement>('[aria-selected="true"]')
									?.focus();
							}
						}}
						placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}`}
						className="h-8 w-full bg-transparent px-2 text-body text-text-1 outline-none placeholder:text-text-3"
						data-testid="picker-search"
					/>
					<div className="-mx-1 my-1 h-px bg-hairline" />
				</>
			)}
			<Command.List
				tabIndex={-1}
				// A short list shows whole and the popover scrolls at the room it has; only a searchable one caps itself.
				className={cn(
					"outline-none",
					rail
						? "min-h-0 flex-1 overflow-y-auto"
						: searchable && "max-h-[320px] overflow-y-auto",
				)}
			>
				<Command.Empty className="px-2 py-1.5 text-body text-text-3">
					{emptyText}
				</Command.Empty>
				{groups.map((g) => (
					<Command.Group
						key={g || "all"}
						heading={g || undefined}
						className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-meta [&_[cmdk-group-heading]]:text-text-3"
					>
						{options
							.filter((o) => (o.group ?? "") === g)
							.map((o) => (
								<Row
									key={`${g}:${o.id}`}
									option={o}
									on={!o.run && values.includes(o.id)}
									onPick={() => pick(o)}
								/>
							))}
					</Command.Group>
				))}
				{actions?.length ? (
					<Command.Group forceMount>
						<div className="-mx-1 my-1 h-px bg-hairline" />
						{actions.map((o) => (
							<Row
								key={`action:${o.id}`}
								option={o}
								on={false}
								onPick={() => pick(o)}
								always
							/>
						))}
					</Command.Group>
				) : null}
			</Command.List>
		</Command>
	);
	if (!rail) return list;
	return (
		// Both panes fit the room the popover has, so the rail's foot (Add agent) stays in view.
		<div className="flex h-[min(400px,calc(var(--radix-popper-available-height,400px)-8px))]">
			<Rail
				rail={rail}
				railRef={railRef}
				toSearch={() =>
					root.current?.querySelector<HTMLElement>("[cmdk-input]")?.focus()
				}
			/>
			{list}
		</div>
	);
}

/**
 * The rail is one tab stop, its shown tile: Up and Down move along the tiles and show each one's rows,
 * Right goes to the search. An action tile (Add agent) runs on Enter or a click.
 */
function Rail({
	rail,
	railRef,
	toSearch,
}: {
	rail: PickerRail;
	railRef: RefObject<HTMLDivElement | null>;
	toSearch: () => void;
}) {
	const shows = rail.items.filter((t) => !t.run);
	const actions = rail.items.filter((t) => t.run);
	const move = (by: number) => {
		const at = shows.findIndex((t) => t.id === rail.value);
		const i = (at + by + shows.length) % shows.length;
		const next = shows[i];
		if (!next) return;
		rail.onChange(next.id);
		railRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[i]?.focus();
	};
	const look =
		"relative flex size-9 shrink-0 items-center justify-center rounded-control text-text-2 hover:bg-surface-3 hover:text-text-1 data-[on]:bg-surface-3 data-[on]:text-text-1";
	const face = (t: PickerRailItem, on: boolean) => (
		<>
			{t.mark ??
				(t.icon && (
					<t.icon aria-hidden className="size-4 shrink-0 stroke-[1.75]" />
				))}
			{on && (
				<span
					aria-hidden
					className="absolute top-2 bottom-2 -left-1 w-0.5 rounded-full bg-accent"
				/>
			)}
		</>
	);
	const tab = (t: PickerRailItem, on: boolean) => (
		<Hint key={t.id} label={t.name} side="left">
			<button
				type="button"
				role="tab"
				aria-selected={on}
				aria-label={t.name}
				tabIndex={on ? 0 : -1}
				onClick={() => rail.onChange(t.id)}
				data-on={on || undefined}
				data-testid={t.testId ?? `rail-${t.id}`}
				className={look}
			>
				{face(t, on)}
			</button>
		</Hint>
	);
	const action = (t: PickerRailItem) => (
		<Hint key={t.id} label={t.name} side="left">
			<button
				type="button"
				aria-label={t.name}
				onClick={() => t.run?.()}
				data-testid={t.testId ?? `rail-${t.id}`}
				className={look}
			>
				{face(t, false)}
			</button>
		</Hint>
	);
	return (
		<div className="relative mr-1 flex shrink-0 flex-col items-center gap-1 py-0.5 pr-1 after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-hairline">
			<div
				ref={railRef}
				role="tablist"
				aria-orientation="vertical"
				aria-label={rail.label}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown" || e.key === "ArrowUp") {
						e.preventDefault();
						move(e.key === "ArrowDown" ? 1 : -1);
					} else if (e.key === "ArrowRight") {
						e.preventDefault();
						toSearch();
					}
				}}
				className="flex min-h-0 flex-col items-center gap-1 overflow-y-auto rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent max-md:gap-3 pointer-coarse:gap-3"
				data-testid="picker-rail"
			>
				{shows.map((t) => tab(t, t.id === rail.value))}
			</div>
			<div className="mt-auto flex shrink-0 flex-col items-center">
				{actions.map((t) => action(t))}
			</div>
		</div>
	);
}

function Row({
	option,
	on,
	onPick,
	always,
}: {
	option: PickerOption;
	on: boolean;
	onPick: () => void;
	/** Shown whatever the search says (an action row). */
	always?: boolean;
}) {
	const roomy = useMediaQuery("(min-width: 640px)");
	// cmdk's item sets its own pointer handlers, so the hint hangs on a span that fills the row.
	const body = (
		<span className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2">
			<OptionIcon option={option} />
			<span className="min-w-0 flex-1 truncate">{option.name}</span>
			{option.warn && (
				<TriangleAlert
					aria-label={option.description ?? "Caution"}
					className="size-3.5 shrink-0 text-warn!"
				/>
			)}
			{on && <Check aria-label="Current" className="size-3.5 shrink-0" />}
		</span>
	);
	return (
		<Command.Item
			value={`${option.group ?? ""}\u0000${option.id}`}
			keywords={[option.name, option.group ?? "", ...(option.keywords ?? [])]}
			forceMount={always}
			onSelect={onPick}
			data-on={on || undefined}
			data-testid={option.testId ?? `picker-option-${option.id}`}
			className="flex h-8 cursor-default items-stretch gap-1 rounded-control pr-2 text-body text-text-1 select-none data-[selected=true]:bg-surface-3 [&_svg]:text-text-2"
		>
			{option.description ? (
				<Hint label={option.description} side={roomy ? "right" : "top"}>
					{body}
				</Hint>
			) : (
				body
			)}
			{option.trailing && (
				<span className="flex shrink-0 items-center">{option.trailing}</span>
			)}
		</Command.Item>
	);
}
