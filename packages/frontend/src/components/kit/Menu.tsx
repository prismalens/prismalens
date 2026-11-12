// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LucideIcon } from "lucide-react";
import { ContextMenu as CM, DropdownMenu as DM } from "radix-ui";
import type { ReactNode } from "react";
import { titleRowHeight } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { FAMILY_CLASS, SURFACE } from "./Popover";

/** A menu row is an icon and a verb, nothing under it (pattern sheet §0.3). */
export type MenuEntry =
	| {
			id: string;
			label: string;
			icon?: LucideIcon;
			onSelect: () => void;
			danger?: boolean;
			disabled?: boolean;
	  }
	| { id: string; separator: true };

const ITEM =
	"relative flex h-8 cursor-default items-center gap-2 rounded-control px-2 text-body outline-hidden select-none focus:bg-surface-3 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[danger]:text-danger";

function Items({
	entries,
	Item,
	Separator,
}: {
	entries: MenuEntry[];
	Item: typeof DM.Item | typeof CM.Item;
	Separator: typeof DM.Separator | typeof CM.Separator;
}) {
	return entries.map((e) =>
		"separator" in e ? (
			<Separator key={e.id} className="mx-1 my-1 h-px bg-hairline" />
		) : (
			<Item
				key={e.id}
				className={ITEM}
				disabled={e.disabled}
				data-danger={e.danger || undefined}
				data-testid={`menu-${e.id}`}
				onSelect={e.onSelect}
			>
				{e.icon && (
					<e.icon
						aria-hidden
						className={cn(
							"size-3.5 shrink-0 stroke-[1.75]",
							e.danger ? "text-danger" : "text-text-3",
						)}
					/>
				)}
				<span className="truncate">{e.label}</span>
			</Item>
		),
	);
}

/** The one menu: 220 px, opening down from its trigger unless `side` says up. */
export function Menu({
	trigger,
	entries,
	label,
	side = "bottom",
	align = "end",
	open,
	onOpenChange,
}: {
	trigger: ReactNode;
	entries: MenuEntry[];
	label: string;
	side?: "top" | "bottom";
	align?: "start" | "end";
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	return (
		<DM.Root open={open} onOpenChange={onOpenChange} modal={false}>
			<DM.Trigger asChild>{trigger}</DM.Trigger>
			<DM.Portal>
				<DM.Content
					side={side}
					align={align}
					sideOffset={4}
					collisionPadding={{ top: titleRowHeight(), bottom: 8 }}
					aria-label={label}
					data-float="pop"
					className={cn(SURFACE, FAMILY_CLASS.menu, "p-1")}
				>
					<Items entries={entries} Item={DM.Item} Separator={DM.Separator} />
				</DM.Content>
			</DM.Portal>
		</DM.Root>
	);
}

/** The same menu on right-click; a row offers both, with the same entries. */
export function ContextMenu({
	entries,
	label,
	children,
}: {
	entries: MenuEntry[];
	label: string;
	children: ReactNode;
}) {
	return (
		<CM.Root modal={false}>
			<CM.Trigger asChild>{children}</CM.Trigger>
			<CM.Portal>
				<CM.Content
					collisionPadding={{ top: titleRowHeight(), bottom: 8 }}
					aria-label={label}
					data-float="pop"
					className={cn(SURFACE, FAMILY_CLASS.menu, "p-1")}
				>
					<Items entries={entries} Item={CM.Item} Separator={CM.Separator} />
				</CM.Content>
			</CM.Portal>
		</CM.Root>
	);
}
