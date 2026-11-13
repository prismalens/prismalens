// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as Slot from "@radix-ui/react-slot";
import {
	type PointerEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";

type Tip = typeof import("./HintTip");
let tip: Tip | null = null;
let tipLoading: Promise<Tip> | null = null;
const loadTip = () => {
	tipLoading ??= import("./HintTip").then((m) => {
		tip = m;
		return m;
	});
	return tipLoading;
};
/** Unit tests show a hint in one pass: their setup hands its floating half over first. */
export function primeHintTip(m: Tip): void {
	tip = m;
}

/** The app's tooltip timing: a hint waits, and the next one shows at once while the eye moves on. */
const DELAY_MS = 400;
const SKIP_MS = 200;
let lastClosed = 0;

/**
 * The only tooltip (a DOM `title` is banned). One line, or a label and one
 * meta line; shortcuts live here and in the ? sheet, never on screen
 * (decision 9). `when={false}` skips it where the label is already visible.
 * `open` also shows it, for a trigger whose focus lands on a parent. Its floating
 * half loads when it first shows, so a page's first frame carries none (#1101 category 12).
 */
export function Hint({
	label,
	meta,
	keys,
	side = "bottom",
	when = true,
	open = false,
	children,
}: {
	label: string;
	meta?: string;
	keys?: string[];
	side?: "top" | "bottom" | "left" | "right";
	when?: boolean;
	open?: boolean;
	children: ReactNode;
}) {
	const [hovered, setHovered] = useState(false);
	// Escape dismisses a hint the parent holds open, until `open` is let go.
	const [dismissed, setDismissed] = useState(false);
	const [Tip, setTip] = useState<Tip | null>(() => tip);
	const anchor = useRef<HTMLElement | null>(null);
	const timer = useRef<number | undefined>(undefined);
	const pressed = useRef(false);
	const id = useId();
	if (!open && dismissed) setDismissed(false);
	const shown = hovered || (open && !dismissed);
	useEffect(() => {
		if (!shown || Tip) return;
		let live = true;
		loadTip().then(
			(m) => {
				if (live) setTip(m);
			},
			() => {},
		);
		return () => {
			live = false;
		};
	}, [shown, Tip]);
	useEffect(() => () => window.clearTimeout(timer.current), []);
	if (!when) return children;
	const wait = () => {
		window.clearTimeout(timer.current);
		timer.current = undefined;
	};
	const close = () => {
		wait();
		setHovered((was) => {
			if (was) lastClosed = Date.now();
			return false;
		});
	};
	return (
		<>
			<Slot.Root
				ref={anchor}
				aria-describedby={shown && Tip ? id : undefined}
				onPointerMove={(e: PointerEvent) => {
					if (e.pointerType === "touch" || hovered || timer.current) return;
					const delay = Date.now() - lastClosed < SKIP_MS ? 0 : DELAY_MS;
					timer.current = window.setTimeout(() => {
						timer.current = undefined;
						setHovered(true);
					}, delay);
				}}
				onPointerLeave={close}
				onPointerDown={() => {
					pressed.current = true;
					close();
				}}
				onFocus={() => {
					if (!pressed.current) setHovered(true);
					pressed.current = false;
				}}
				onBlur={close}
			>
				{children}
			</Slot.Root>
			{shown && Tip && (
				<Tip.HintTip
					id={id}
					anchor={anchor}
					side={side}
					label={label}
					meta={meta}
					keys={keys}
					onClose={close}
					onEscape={() => {
						if (open) setDismissed(true);
						close();
					}}
				/>
			)}
		</>
	);
}

/** Keys shown on a page that lists tools with their shortcuts (the New tab page, the palette). */
export function Keys({ keys }: { keys: string[] }) {
	return (
		<span className="flex shrink-0 gap-0.5" aria-hidden>
			{keys.map((k) => (
				<kbd
					key={k}
					className="min-w-5 rounded-[4px] bg-surface-3 px-1 text-center font-sans text-meta text-text-3"
				>
					{k}
				</kbd>
			))}
		</span>
	);
}
