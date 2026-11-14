// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as DM from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { titleRowHeight } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { isMac, keyText, type MenuEntry, orderEntries } from "./menu-entries";
import { FAMILY_CLASS, SURFACE } from "./Popover";

// The menus' Radix half: loaded after a page's first content, or on the first open (#1101 category 12).

const ITEM =
	"relative flex h-8 cursor-default items-center gap-2 rounded-control px-2 text-body outline-hidden select-none focus:bg-surface-3 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[danger]:text-danger";

function Items({
	entries,
	Item,
	Separator,
}: {
	entries: MenuEntry[];
	Item: typeof DM.Item;
	Separator: typeof DM.Separator;
}) {
	return orderEntries(entries).map((e) => {
		if ("separator" in e)
			return <Separator key={e.id} className="mx-1 my-1 h-px bg-hairline" />;
		const keys = e.keys ?? "";
		return (
			<Item
				key={e.id}
				className={ITEM}
				disabled={e.disabled}
				data-danger={e.danger || undefined}
				data-testid={`menu-${e.id}`}
				aria-keyshortcuts={
					keys
						? keys.replaceAll("Mod", isMac() ? "Meta" : "Control")
						: undefined
				}
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
				<span className="min-w-0 flex-1 truncate">{e.label}</span>
				{e.disabled && e.why ? (
					<span
						className="min-w-0 max-w-[55%] shrink truncate text-meta text-text-3"
						data-testid={`menu-${e.id}-why`}
					>
						{e.why}
					</span>
				) : (
					keys && (
						<kbd
							aria-hidden
							className="shrink-0 font-sans text-meta text-text-3"
							data-testid={`menu-${e.id}-keys`}
						>
							{keyText(keys)}
						</kbd>
					)
				)}
				{e.checked && (
					<Check aria-label="On" className="size-3.5 shrink-0 text-text-2" />
				)}
			</Item>
		);
	});
}

export interface MenuProps {
	trigger: ReactNode;
	entries: MenuEntry[];
	label: string;
	side?: "top" | "bottom";
	align?: "start" | "end";
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
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
	defaultOpen,
}: MenuProps & {
	/** Pressed before this code arrived: it opens as it mounts. */
	defaultOpen?: boolean;
}) {
	return (
		<DM.Root
			open={open}
			defaultOpen={defaultOpen}
			onOpenChange={onOpenChange}
			modal={false}
		>
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

/**
 * The context menu, opened at a point: an open menu anchored on a zero-size span there.
 * No synthetic contextmenu is sent, so no ancestor's handler can swallow it (#1101 right-click).
 */
export function ContextMenuAt({
	at,
	entries,
	label,
	onClose,
}: {
	at: { x: number; y: number };
	entries: () => MenuEntry[];
	label: string;
	onClose: () => void;
}) {
	return (
		<DM.Root
			key={`${at.x},${at.y}`}
			open
			modal={false}
			onOpenChange={(open) => !open && onClose()}
		>
			<DM.Trigger asChild>
				<span
					aria-hidden
					style={{
						position: "fixed",
						left: at.x,
						top: at.y,
						width: 0,
						height: 0,
					}}
				/>
			</DM.Trigger>
			<DM.Portal>
				<DM.Content
					side="bottom"
					align="start"
					sideOffset={0}
					collisionPadding={{ top: titleRowHeight(), bottom: 8 }}
					aria-label={label}
					data-float="pop"
					className={cn(SURFACE, FAMILY_CLASS.menu, "p-1")}
				>
					<Items entries={entries()} Item={DM.Item} Separator={DM.Separator} />
				</DM.Content>
			</DM.Portal>
		</DM.Root>
	);
}
