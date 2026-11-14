// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronDown, Lock, type LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Hint } from "@/components/shared/Hint";
import { lazyModule } from "@/lib/lazy";
import { cn } from "@/lib/utils";
import { KitPopover } from "./Popover";

const TOLD_MS = 3000;

export interface PickerOption {
	id: string;
	name: string;
	/** Shown only as a tooltip on the row (pattern sheet §5). */
	description?: string;
	icon?: LucideIcon;
	/** A brand mark or other node in place of a Lucide icon. */
	mark?: ReactNode;
	/** Rows with a group sit under its name; the name is the only heading. */
	group?: string;
	/** A caution the row carries: a warn mark, its words in the tooltip. */
	warn?: boolean;
	/** One control at the row's end, such as a star; it must stop the row's own select. */
	trailing?: ReactNode;
	/** An action row: selecting it runs this instead of choosing the row. */
	run?: () => void;
	/** Extra words the search matches, such as the model id. */
	keywords?: string[];
	testId?: string;
}

/** The list and its search load when a picker first opens (#1101 category 12). */
export const pickerList = lazyModule(() => import("./PickerList"));

/**
 * A composer picker (model, effort, permission): a quiet trigger and a
 * 280 px list opening upward, one icon and a name per row, the current one
 * checked. A locked picker keeps its trigger and says why in the tooltip.
 */
export function Picker({
	label,
	options,
	value,
	onChange,
	locked,
	disabled,
	display,
	actions,
	emptyText = "No match",
	searchPlaceholder,
	side = "top",
	compact,
	short,
	open,
	onOpenChange,
	testId,
	listTestId,
}: {
	/** The control's name for screen readers and the search placeholder. */
	label: string;
	options: PickerOption[];
	/** The current row, or one per group where a picker holds two choices. */
	value: string | string[];
	onChange: (id: string) => void;
	/** Why the choice is fixed; set, the picker shows a lock and does not open. */
	locked?: string;
	/** Off for a moment (the box is sending), with no reason to give. */
	disabled?: boolean;
	/** What the trigger shows when it is not the current row's own name and icon. */
	display?: {
		name: string;
		icon?: LucideIcon;
		mark?: ReactNode;
	};
	/** Action rows under a hairline at the end, such as "Add agent". */
	actions?: PickerOption[];
	emptyText?: string;
	searchPlaceholder?: string;
	side?: "top" | "bottom";
	/** On a phone the trigger is its icon alone; the name stays in its label. */
	compact?: boolean;
	/** On a phone the trigger shows this shorter name; the full one stays in its label. */
	short?: (name: string) => string;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	testId?: string;
	listTestId?: string;
}) {
	const [own, setOwn] = useState(false);
	// A click on a locked picker shows its reason, where a hover never comes (a tap, a key).
	const [told, setTold] = useState(false);
	useEffect(() => {
		if (!told) return;
		const t = setTimeout(() => setTold(false), TOLD_MS);
		return () => clearTimeout(t);
	}, [told]);
	const isOpen = locked || disabled ? false : (open ?? own);
	const setOpen = (o: boolean) => {
		if (locked || disabled) return;
		setOwn(o);
		onOpenChange?.(o);
	};
	const List = pickerList.useLoaded(isOpen)?.PickerList;
	const values = Array.isArray(value) ? value : [value];
	const current = options.find((o) => values.includes(o.id));
	const shown = display ?? current;
	const trigger = (
		<button
			type="button"
			aria-label={`${label}: ${shown?.name ?? "none"}`}
			aria-disabled={locked ? true : undefined}
			disabled={disabled}
			data-testid={testId}
			data-locked={locked ? "" : undefined}
			onClick={locked ? () => setTold(true) : undefined}
			onBlur={locked ? () => setTold(false) : undefined}
			className={cn(
				"inline-flex h-7 max-w-[220px] min-w-0 shrink-0 items-center max-sm:h-11 max-sm:min-w-11 max-sm:max-w-[140px] max-sm:justify-center gap-1.5 rounded-control px-2 text-body font-medium text-text-2 outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:text-text-3 data-[state=open]:bg-surface-3 data-[state=open]:text-text-1",
				locked || disabled
					? "cursor-default"
					: "hover:bg-surface-3 hover:text-text-1",
			)}
		>
			<OptionIcon option={shown} />
			<span
				className={cn(
					"truncate",
					compact && "max-sm:sr-only",
					short && "max-sm:hidden",
				)}
			>
				{shown?.name ?? label}
			</span>
			{short && !compact && (
				<span aria-hidden className="truncate sm:hidden">
					{short(shown?.name ?? label)}
				</span>
			)}
			{locked ? (
				<Lock aria-hidden className="size-3 shrink-0 text-text-3" />
			) : (
				<ChevronDown
					aria-hidden
					className={cn(
						"size-3 shrink-0 text-text-3",
						compact && "max-sm:hidden",
					)}
				/>
			)}
		</button>
	);
	// A compact locked picker can't change and a phone can't hover its reason: it hides there.
	if (locked && compact)
		return (
			<span className="contents max-sm:hidden">
				<Hint label={locked} side={side} open={told}>
					{trigger}
				</Hint>
			</span>
		);
	if (locked)
		return (
			<Hint label={locked} side={side} open={told}>
				{trigger}
			</Hint>
		);

	const groups = options
		.map((o) => o.group ?? "")
		.filter((g, i, all) => all.indexOf(g) === i);
	const pick = (o: PickerOption) => {
		setOpen(false);
		if (o.run) o.run();
		else if (!values.includes(o.id)) onChange(o.id);
	};
	return (
		<KitPopover
			trigger={trigger}
			family="picker"
			side={side}
			label={label}
			open={isOpen}
			onOpenChange={setOpen}
		>
			{List && (
				<List
					label={label}
					options={options}
					groups={groups}
					values={values}
					actions={actions}
					emptyText={emptyText}
					searchPlaceholder={searchPlaceholder}
					listTestId={listTestId}
					pick={pick}
				/>
			)}
		</KitPopover>
	);
}

export function OptionIcon({
	option,
}: {
	option?: Pick<PickerOption, "icon" | "mark">;
}) {
	if (option?.mark)
		return <span className="flex size-3.5 shrink-0">{option.mark}</span>;
	if (option?.icon)
		return (
			<option.icon aria-hidden className="size-3.5 shrink-0 stroke-[1.75]" />
		);
	return null;
}
