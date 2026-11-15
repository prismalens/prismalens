// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The docked composer's box: the run page draws its stand-in in the same box while the
 * composer's code loads, so nothing moves when it arrives (#1130).
 */
export function DockedFrame({
	floating,
	children,
}: {
	floating?: boolean;
	children: ReactNode;
}) {
	return (
		<div
			className={cn(
				"shrink-0",
				!floating &&
					"px-4 pt-2 pb-3 max-md:pb-[calc(0.75rem+var(--kb-inset,0px))]",
			)}
			data-testid="docked-composer"
		>
			<div className="mx-auto w-full max-w-(--lane-w)">{children}</div>
		</div>
	);
}
