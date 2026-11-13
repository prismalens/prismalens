// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type * as PopoverPrimitive from "@radix-ui/react-popover";
import {
	type ComponentPropsWithoutRef,
	lazy,
	type ReactNode,
	Suspense,
	useState,
} from "react";
import { Hint } from "@/components/shared/Hint";
import { useAfterFirstContent } from "@/lib/lazy";
import { Pressed } from "./Menu";

/**
 * One width per family (pattern sheet §0.5): menus 220, pickers and the
 * details card 280, an ask beside a row 320. A caller picks the family,
 * never a width.
 */
export const POPOVER_WIDTH = { menu: 220, picker: 280, card: 320 } as const;
export type PopoverFamily = keyof typeof POPOVER_WIDTH;

export const FAMILY_CLASS: Record<PopoverFamily, string> = {
	menu: "w-[220px]",
	picker: "w-[280px]",
	card: "w-[320px]",
};

/** Content sits on the shared floating surface; from the composer it opens up. */
export const SURFACE =
	"floating z-50 max-h-(--radix-popper-available-height) overflow-y-auto rounded-pool text-text-1 outline-none";

export interface KitPopoverProps {
	trigger: ReactNode;
	family: PopoverFamily;
	/** `top` from the composer, `right` beside a sidebar row, `bottom` everywhere else. */
	side?: "top" | "bottom" | "right";
	align?: "start" | "center" | "end";
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	/** The surface's accessible name. */
	label: string;
	/** A tooltip on the trigger, for an icon-only trigger. */
	hint?: string;
	children: ReactNode;
	contentProps?: Omit<
		ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>,
		"side" | "align" | "className"
	>;
}

const PopoverPart = lazy(() =>
	import("./PopoverImpl").then((m) => ({ default: m.KitPopover })),
);

/**
 * A popover of one family. Its trigger draws on the first frame; its Radix half loads after
 * the page's first content, or at once when pressed or held open (#1101 category 12).
 */
export function KitPopover(props: KitPopoverProps) {
	const ready = useAfterFirstContent();
	const [pressed, setPressed] = useState(false);
	// A held-open popover is its parent's: an early press asks the parent too.
	const press = () => {
		setPressed(true);
		props.onOpenChange?.(true);
	};
	const t = <Pressed onPress={press}>{props.trigger}</Pressed>;
	const held = props.hint ? <Hint label={props.hint}>{t}</Hint> : t;
	if (!ready && !pressed && !props.open) return held;
	return (
		<Suspense fallback={held}>
			<PopoverPart {...props} defaultOpen={pressed} />
		</Suspense>
	);
}
