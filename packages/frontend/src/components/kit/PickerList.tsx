// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Command } from "cmdk";
import { Check, TriangleAlert } from "lucide-react";
import { Hint } from "@/components/shared/Hint";
import { useMediaQuery } from "@/hooks/use-media-query";
import { OptionIcon, type PickerOption } from "./Picker";

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
}) {
	return (
		<Command
			loop
			label={label}
			className="flex flex-col"
			data-testid={listTestId}
			filter={(_, search, keywords) =>
				keywords?.some((k) => k.toLowerCase().includes(search.toLowerCase()))
					? 1
					: 0
			}
		>
			{options.length >= SEARCH_FROM && (
				<>
					<Command.Input
						placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}`}
						className="h-8 w-full bg-transparent px-2 text-body text-text-1 outline-none placeholder:text-text-3"
						data-testid="picker-search"
					/>
					<div className="-mx-1 my-1 h-px bg-hairline" />
				</>
			)}
			<Command.List className="max-h-[320px] overflow-y-auto">
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
