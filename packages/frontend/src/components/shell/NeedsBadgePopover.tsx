// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as P from "@radix-ui/react-popover";
import { useEffect, useRef, useState } from "react";
import { FAMILY_CLASS, SURFACE } from "@/components/kit/Popover";
import {
	BADGE_CLASS,
	BadgeFace,
	type BadgeFaceProps,
	type BadgeProps,
	badgeLabel,
} from "@/components/shell/NeedsBadge";
import { NeedsPopoverList } from "@/components/shell/NeedsList";
import { cn } from "@/lib/utils";

/** How long a pointer may cross from the badge to its list, or leave it, before it closes. */
const HOVER_MS = 150;

/**
 * The badge with its list: hover or focus previews the waiting threads grouped by urgency,
 * and a click or tap keeps them open, each with its one fix.
 */
export function NeedsBadgePopover({
	className,
	countClassName,
	testId,
	side = "bottom",
	count,
	top,
}: BadgeProps & BadgeFaceProps) {
	const [open, setOpen] = useState(false);
	const pinned = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	const later = (next: boolean) => {
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setOpen(next), HOVER_MS);
	};
	const hoverIn = (e: React.PointerEvent) => {
		if (e.pointerType !== "touch") later(true);
	};
	const hoverOut = (e: React.PointerEvent) => {
		if (e.pointerType !== "touch" && !pinned.current) later(false);
	};
	return (
		<P.Root
			open={open}
			onOpenChange={(next) => {
				clearTimeout(timer.current);
				if (!next) pinned.current = false;
				setOpen(next);
			}}
		>
			<P.Trigger asChild>
				<button
					type="button"
					aria-label={badgeLabel(count)}
					onPointerEnter={hoverIn}
					onPointerLeave={hoverOut}
					onFocus={(e) => e.target.matches(":focus-visible") && later(true)}
					onClick={(e) => {
						// A click keeps the list open; Radix's own toggle runs after this.
						if (open && !pinned.current) {
							e.preventDefault();
							pinned.current = true;
						} else pinned.current = !open;
					}}
					className={cn(BADGE_CLASS, className)}
					data-testid={testId}
					data-urgent={top}
				>
					<BadgeFace count={count} top={top} countClassName={countClassName} />
				</button>
			</P.Trigger>
			<P.Portal>
				<P.Content
					side={side}
					align="start"
					sideOffset={6}
					collisionPadding={8}
					aria-label="Needs you"
					onPointerEnter={() => clearTimeout(timer.current)}
					onPointerLeave={hoverOut}
					onOpenAutoFocus={(e) => !pinned.current && e.preventDefault()}
					data-float="pop"
					className={cn(
						SURFACE,
						FAMILY_CLASS.card,
						"flex max-h-[min(70vh,560px)] w-[min(400px,calc(100vw-16px))] flex-col overflow-y-auto p-2",
					)}
					data-testid="needs-popover"
				>
					<NeedsPopoverList />
				</P.Content>
			</P.Portal>
		</P.Root>
	);
}
