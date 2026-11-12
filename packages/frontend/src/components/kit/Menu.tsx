// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Check, type LucideIcon } from "lucide-react";
import { ContextMenu as CM, DropdownMenu as DM } from "radix-ui";
import {
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent,
	type ReactNode,
	useRef,
	useState,
} from "react";
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
			/** A choice that is on: a tick at the row's end. */
			checked?: boolean;
			/** The entry's binding from the shortcut registry (`bindingOf(id)`), shown at the row's end. */
			keys?: string;
	  }
	| { id: string; separator: true };

/**
 * One order for every menu: destructive entries last behind one separator,
 * and no leading, trailing or doubled separators.
 */
export function orderEntries(entries: readonly MenuEntry[]): MenuEntry[] {
	const danger = (e: MenuEntry) => !("separator" in e) && !!e.danger;
	const clean = (list: readonly MenuEntry[]) => {
		const out: MenuEntry[] = [];
		for (const e of list) {
			const last = out.at(-1);
			if ("separator" in e && (!last || "separator" in last)) continue;
			out.push(e);
		}
		while (out.length && "separator" in (out.at(-1) as MenuEntry)) out.pop();
		return out;
	};
	const nonDanger = clean(entries.filter((e) => !danger(e)));
	const dangerEntries = entries.filter(danger);
	if (!dangerEntries.length) return nonDanger;
	if (!nonDanger.length) return dangerEntries;
	return [
		...nonDanger,
		{ id: "sep-danger", separator: true },
		...dangerEntries,
	];
}

/** The entries a palette lists for an object: its menu rows without separators. */
export function commandEntries(entries: readonly MenuEntry[]) {
	return orderEntries(entries).filter(
		(e): e is Exclude<MenuEntry, { separator: true }> => !("separator" in e),
	);
}

const isMac = () =>
	typeof navigator !== "undefined" &&
	/Mac|iPhone|iPad/.test(navigator.platform);

/** A binding as the user's keyboard names it: Mod is Cmd on a Mac, Ctrl elsewhere. */
export const keyText = (keys: string) =>
	keys.replaceAll("Mod", isMac() ? "Cmd" : "Ctrl");

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
				{keys && (
					<kbd
						aria-hidden
						className="shrink-0 font-sans text-meta text-text-3"
						data-testid={`menu-${e.id}-keys`}
					>
						{keyText(keys)}
					</kbd>
				)}
				{e.checked && (
					<Check aria-label="On" className="size-3.5 shrink-0 text-text-2" />
				)}
			</Item>
		);
	});
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

/** Shift+F10 or the Menu key, the keyboard's right-click. */
export const isMenuKey = (e: { key: string; shiftKey: boolean }) =>
	e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");

/** True when the user has text selected inside `el`: the browser's Copy menu wins there. */
function selectedWithin(el: Element): boolean {
	const sel = typeof window === "undefined" ? null : window.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
	return sel.getRangeAt(0).intersectsNode(el);
}

/**
 * The same menu on right-click; a row offers both, with the same entries.
 * Shift+F10 and the Menu key open it on the focused object, a long press opens
 * it on touch (Radix, 700 ms), and selected text keeps the browser's own menu.
 */
export function ContextMenu({
	entries,
	label,
	children,
	nativeOnLinks,
}: {
	entries: MenuEntry[];
	label: string;
	children: ReactNode;
	/** Right-clicking a link inside keeps the browser's menu (open in a new tab). */
	nativeOnLinks?: boolean;
}) {
	const [native, setNative] = useState(false);
	// The Menu key also fires a native contextmenu after ours; it only re-opens.
	const fromKeys = useRef(0);
	const onPointerDown = (e: PointerEvent<HTMLElement>) => {
		if (e.button !== 2) return;
		const link =
			nativeOnLinks && (e.target as Element).closest?.("a[href]") !== null;
		setNative(link || selectedWithin(e.currentTarget));
	};
	const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
		if (e.defaultPrevented || !isMenuKey(e)) return;
		e.preventDefault();
		setNative(false);
		fromKeys.current = Date.now();
		const at = (e.target as Element).getBoundingClientRect();
		e.currentTarget.dispatchEvent(
			new window.MouseEvent("contextmenu", {
				bubbles: true,
				cancelable: true,
				clientX: at.left + 8,
				clientY: at.bottom,
			}),
		);
	};
	const onContextMenu = (e: MouseEvent<HTMLElement>) => {
		if (e.isTrusted && Date.now() - fromKeys.current < 500) e.preventDefault();
	};
	return (
		<CM.Root modal={false}>
			<CM.Trigger
				asChild
				disabled={native}
				onPointerDown={onPointerDown}
				onKeyDown={onKeyDown}
				onContextMenu={onContextMenu}
			>
				{children}
			</CM.Trigger>
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
