// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A message's sender, time and verb without a row of their own (`META_SENDER`, `META_STATE`
 * in `lib/fold.ts`): shown in the gap beside the message on hover or focus, by a tap on the
 * phone, and always to a screen reader. Escape hides it until the pointer or focus leaves.
 */
export function useMessageMeta() {
	const [open, setOpen] = useState(false);
	const [dismissed, setDismissed] = useState(false);
	return {
		open,
		dismissed,
		/** Props for the message's own element, which becomes the hover group. */
		host: {
			tabIndex: 0,
			onClick: (e: React.MouseEvent) => {
				// A tap on a link or button inside acts on that, not on the meta.
				if ((e.target as HTMLElement).closest("a,button")) return;
				setOpen((o) => !o);
			},
			onKeyDown: (e: React.KeyboardEvent) => {
				if (e.key === "Escape" && !dismissed) {
					setDismissed(true);
					setOpen(false);
				}
			},
			onPointerLeave: () => setDismissed(false),
			onBlur: () => setDismissed(false),
		},
	};
}

export function MessageMeta({
	open,
	dismissed,
	side,
	children,
}: {
	open: boolean;
	dismissed: boolean;
	/** The message's free side: the gap the meta sits in. */
	side: "left" | "below";
	children: ReactNode;
}) {
	return (
		<span
			className={cn(
				"absolute whitespace-nowrap text-meta text-text-3 tabular-nums opacity-0 transition-opacity duration-150",
				side === "left" ? "right-full bottom-2 mr-2" : "top-full left-0 mt-0.5",
				!dismissed &&
					"md:group-hover/msg:opacity-100 md:group-focus-within/msg:opacity-100",
				// On the phone a tap opens it inside the message: a shift the reader asked for.
				open &&
					"max-md:static max-md:mr-0 max-md:whitespace-normal max-md:opacity-100",
			)}
			data-testid="message-meta"
			data-open={open || undefined}
		>
			{children}
		</span>
	);
}
