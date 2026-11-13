// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as Slot from "@radix-ui/react-slot";
import {
	type KeyboardEvent,
	lazy,
	type MouseEvent,
	type PointerEvent,
	type ReactNode,
	Suspense,
	useRef,
	useState,
} from "react";
import { lazyPart, useAfterFirstContent } from "@/lib/lazy";
import type { MenuProps } from "./MenuImpl";
import { isMenuKey, type MenuEntry, selectedWithin } from "./menu-entries";

export {
	commandEntries,
	isMenuKey,
	keyText,
	type MenuEntry,
	orderEntries,
} from "./menu-entries";

// A menu's trigger draws on the first frame; its Radix half loads after the page's first
// content, or at once when pressed (#1101 category 12).
const loadImpl = () => import("./MenuImpl");
const MenuPart = lazy(() => loadImpl().then((m) => ({ default: m.Menu })));
export const ContextMenuAt = lazyPart(() =>
	loadImpl().then((m) => m.ContextMenuAt),
);

/** A trigger pressed before the menu's code arrived: the menu opens once it does. */
export function Pressed({
	onPress,
	children,
}: {
	onPress: () => void;
	children: ReactNode;
}) {
	return (
		<Slot.Root
			onPointerDown={(e: PointerEvent) => {
				if (e.button === 0) onPress();
			}}
			onKeyDown={(e: KeyboardEvent) => {
				if (e.key !== "Enter" && e.key !== " " && e.key !== "ArrowDown") return;
				e.preventDefault();
				onPress();
			}}
		>
			{children}
		</Slot.Root>
	);
}

/** The one menu: 220 px, opening down from its trigger unless `side` says up. */
export function Menu(props: MenuProps) {
	const ready = useAfterFirstContent();
	const [pressed, setPressed] = useState(false);
	const held = (
		<Pressed onPress={() => setPressed(true)}>{props.trigger}</Pressed>
	);
	if (!ready && !pressed) return held;
	return (
		<Suspense fallback={held}>
			<MenuPart {...props} defaultOpen={pressed} />
		</Suspense>
	);
}

type Point = { x: number; y: number };

/**
 * A context menu's trigger: right-click, Shift+F10, the Menu key and a 700 ms touch press
 * open it at the point; selected text, and links when asked, keep the browser's menu. An
 * inner trigger that handled the event first wins.
 */
export function useContextTrigger(nativeOnLinks = false) {
	const [at, setAt] = useState<Point | null>(null);
	const native = useRef(false);
	const fromKeys = useRef(0);
	const press = useRef<number | null>(null);
	const unpress = () => {
		if (press.current === null) return;
		window.clearTimeout(press.current);
		press.current = null;
	};
	const handlers = {
		onPointerDown: (e: PointerEvent<HTMLElement>) => {
			if (e.button === 2) {
				const link =
					nativeOnLinks && (e.target as Element).closest?.("a[href]") !== null;
				native.current = link || selectedWithin(e.currentTarget);
			} else if (e.pointerType === "touch") {
				unpress();
				const point = { x: e.clientX, y: e.clientY };
				press.current = window.setTimeout(() => {
					press.current = null;
					setAt(point);
				}, 700);
			}
		},
		onPointerMove: unpress,
		onPointerUp: unpress,
		onPointerCancel: unpress,
		onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
			if (e.defaultPrevented || !isMenuKey(e)) return;
			e.preventDefault();
			native.current = false;
			fromKeys.current = Date.now();
			const box = (e.target as Element).getBoundingClientRect();
			setAt({ x: box.left + 8, y: box.bottom });
		},
		onContextMenu: (e: MouseEvent<HTMLElement>) => {
			if (e.defaultPrevented) return;
			if (native.current) {
				native.current = false;
				return;
			}
			e.preventDefault();
			// The Menu key also fires a native contextmenu after its keydown; that one only re-opens.
			if (Date.now() - fromKeys.current < 500) return;
			setAt({ x: e.clientX, y: e.clientY });
		},
	};
	return { at, close: () => setAt(null), handlers };
}

/**
 * The same menu on right-click; a row offers both, with the same entries.
 * Shift+F10 and the Menu key open it on the focused object, a long press opens
 * it on touch, and selected text keeps the browser's own menu.
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
	const { at, close, handlers } = useContextTrigger(nativeOnLinks);
	return (
		<>
			<Slot.Root {...handlers}>{children}</Slot.Root>
			{at && (
				<ContextMenuAt
					at={at}
					entries={() => entries}
					label={label}
					onClose={close}
				/>
			)}
		</>
	);
}
