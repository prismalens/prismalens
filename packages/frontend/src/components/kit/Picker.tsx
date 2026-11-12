// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Command } from "cmdk";
import { Check, ChevronDown, Lock, type LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Hint } from "@/components/shared/Hint";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { KitPopover } from "./Popover";

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
}

/** Past this many rows the picker gets a search field. */
const SEARCH_FROM = 9;

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
	side = "top",
	open,
	onOpenChange,
	testId,
}: {
	/** The control's name for screen readers and the search placeholder. */
	label: string;
	options: PickerOption[];
	value: string;
	onChange: (id: string) => void;
	/** Why the choice is fixed; set, the picker shows a lock and does not open. */
	locked?: string;
	side?: "top" | "bottom";
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	testId?: string;
}) {
	const [own, setOwn] = useState(false);
	const isOpen = locked ? false : (open ?? own);
	const setOpen = (o: boolean) => {
		if (locked) return;
		setOwn(o);
		onOpenChange?.(o);
	};
	const current = options.find((o) => o.id === value);
	const trigger = (
		<button
			type="button"
			aria-label={`${label}: ${current?.name ?? "none"}`}
			aria-disabled={locked ? true : undefined}
			data-testid={testId}
			className={cn(
				"inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-control px-2 text-body font-medium text-text-2 outline-none focus-visible:ring-2 focus-visible:ring-accent",
				locked ? "cursor-default" : "hover:bg-surface-3 hover:text-text-1",
			)}
		>
			<OptionIcon option={current} />
			<span className="truncate">{current?.name ?? label}</span>
			{locked ? (
				<Lock aria-hidden className="size-3 shrink-0 text-text-3" />
			) : (
				<ChevronDown aria-hidden className="size-3 shrink-0 text-text-3" />
			)}
		</button>
	);
	if (locked) return <Hint label={locked}>{trigger}</Hint>;

	const groups = options
		.map((o) => o.group ?? "")
		.filter((g, i, all) => all.indexOf(g) === i);
	return (
		<KitPopover
			trigger={trigger}
			family="picker"
			side={side}
			label={label}
			open={isOpen}
			onOpenChange={setOpen}
		>
			<Command
				loop
				label={label}
				className="flex flex-col"
				filter={(_, search, keywords) =>
					keywords?.some((k) => k.toLowerCase().includes(search.toLowerCase()))
						? 1
						: 0
				}
			>
				{options.length >= SEARCH_FROM && (
					<>
						<Command.Input
							placeholder={`Search ${label.toLowerCase()}`}
							className="h-8 w-full bg-transparent px-2 text-body text-text-1 outline-none placeholder:text-text-3"
						/>
						<div className="-mx-1 my-1 h-px bg-hairline" />
					</>
				)}
				<Command.List className="max-h-[320px] overflow-y-auto">
					<Command.Empty className="px-2 py-1.5 text-body text-text-3">
						No match
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
										key={o.id}
										option={o}
										on={o.id === value}
										onPick={() => {
											onChange(o.id);
											setOpen(false);
										}}
									/>
								))}
						</Command.Group>
					))}
				</Command.List>
			</Command>
		</KitPopover>
	);
}

function OptionIcon({ option }: { option?: PickerOption }) {
	if (option?.mark)
		return <span className="flex size-3.5 shrink-0">{option.mark}</span>;
	if (option?.icon)
		return (
			<option.icon aria-hidden className="size-3.5 shrink-0 stroke-[1.75]" />
		);
	return null;
}

function Row({
	option,
	on,
	onPick,
}: {
	option: PickerOption;
	on: boolean;
	onPick: () => void;
}) {
	const roomy = useMediaQuery("(min-width: 640px)");
	// cmdk's item sets its own pointer handlers, so the hint hangs on a span that fills the row.
	const body = (
		<span className="flex h-full min-w-0 flex-1 items-center gap-2 px-2">
			<OptionIcon option={option} />
			<span className="min-w-0 flex-1 truncate">{option.name}</span>
			{on && <Check aria-label="Current" className="size-3.5 shrink-0" />}
		</span>
	);
	return (
		<Command.Item
			value={option.id}
			keywords={[option.name, option.group ?? ""]}
			onSelect={onPick}
			data-on={on || undefined}
			data-testid={`picker-option-${option.id}`}
			className="flex h-8 cursor-default items-stretch rounded-control text-body text-text-1 select-none data-[selected=true]:bg-surface-3 [&_svg]:text-text-2"
		>
			{option.description ? (
				<Hint label={option.description} side={roomy ? "right" : "top"}>
					{body}
				</Hint>
			) : (
				body
			)}
		</Command.Item>
	);
}
