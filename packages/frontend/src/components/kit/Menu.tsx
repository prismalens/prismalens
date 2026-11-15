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
	useEffect,
	useRef,
	useState,
} from "react";
import { listenKeys } from "@/hooks/use-global-shortcuts";
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
// It mounts only once pressed, so its code skips the load lane (#1130).
export const ContextMenuAt = lazyPart(
	() => loadImpl().then((m) => m.ContextMenuAt),
	null,
	{ now: true },
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
	// A held-open menu is its parent's: an early press asks the parent too.
	const held = (
		<Pressed
			onPress={() => {
				setPressed(true);
				props.onOpenChange?.(true);
			}}
		>
			{props.trigger}
		</Pressed>
	);
	if (!ready && !pressed) return held;
	return (
		<Suspense fallback={held}>
			<MenuPart {...props} defaultOpen={pressed} />
		</Suspense>
	);
}

const FOCUSABLE =
	"a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])";
const FOCUS_RING = ["focus-visible:outline-2", "focus-visible:outline-accent"];

/**
 * A surface with a menu takes focus, so Shift+F10 and the Menu key can open it from the
 * keyboard (#1101, right-click); a natively focusable row and text inside an editor keep theirs.
 */
export function focusable(el: HTMLElement | null) {
	if (!el || el.hasAttribute("tabindex") || el.tabIndex >= 0) return;
	if (el.isContentEditable || el.closest("[contenteditable=true]")) return;
	// A row with its own controls is reached through them; it still takes focus on click.
	const inner =
		el.querySelector(FOCUSABLE) ??
		Array.from(el.querySelectorAll("*")).find((n) => n.shadowRoot);
	el.tabIndex = inner ? -1 : 0;
	el.classList.add(...FOCUS_RING);
}

type Point = { x: number; y: number };

/** Marks an element that opens a context menu; the keyboard fallback looks for it. */
const MENU_ATTR = "data-context-menu";
let installed = false;
let pointed: Element | null = null;
let keyedAt = 0;

/**
 * Shift+F10 and the Menu key reach every registered menu (#1101, right-click): when the
 * focused element has none, the menu of the object under the pointer opens, and the
 * browser's own menu that follows the Menu key is held back.
 */
function installKeyMenus() {
	if (installed || typeof document === "undefined") return;
	installed = true;
	document.addEventListener(
		"pointerover",
		(e) => {
			pointed = e.target instanceof Element ? e.target : null;
		},
		{ capture: true, passive: true },
	);
	listenKeys((e) => {
		if (e.defaultPrevented || !isMenuKey(e)) return;
		const focused =
			document.activeElement instanceof Element &&
			document.activeElement !== document.body
				? document.activeElement
				: null;
		// A focused field keeps its own menu; only an idle page falls back to the pointer.
		if (focused?.closest("input, textarea, [contenteditable=true]")) return;
		const target =
			focused?.closest(`[${MENU_ATTR}]`) ??
			(focused ? null : pointed?.isConnected ? pointed : null);
		const owner = target?.closest(`[${MENU_ATTR}]`);
		if (!target || !owner) return;
		e.preventDefault();
		keyedAt = Date.now();
		const box = owner.getBoundingClientRect();
		target.dispatchEvent(
			new MouseEvent("contextmenu", {
				bubbles: true,
				cancelable: true,
				clientX: Math.max(0, box.left + 8),
				clientY: Math.min(window.innerHeight - 8, Math.max(0, box.top) + 20),
			}),
		);
	});
	document.addEventListener(
		"contextmenu",
		(e) => {
			if (e.isTrusted && Date.now() - keyedAt < 500) {
				e.preventDefault();
				e.stopPropagation();
			}
		},
		{ capture: true },
	);
}

/**
 * A context menu's trigger: right-click, Shift+F10, the Menu key and a 700 ms touch press
 * open it at the point; selected text, and links when asked, keep the browser's menu. An
 * inner trigger that handled the event first wins.
 */
export function useContextTrigger(nativeOnLinks = false) {
	useEffect(installKeyMenus, []);
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
		[MENU_ATTR]: "",
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
			<Slot.Root ref={focusable} {...handlers}>
				{children}
			</Slot.Root>
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
