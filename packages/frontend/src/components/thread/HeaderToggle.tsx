// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { Hint } from "@/components/shared/Hint";
import { cn } from "@/lib/utils";

/** A header toggle in its fixed slot: there from the first paint, so nothing pops in. */
export function HeaderToggle({
	label,
	pressed,
	disabled,
	onToggle,
	icon,
	testId,
	controls,
}: {
	label: string;
	pressed: boolean;
	disabled: boolean;
	onToggle: () => void;
	icon: ReactNode;
	testId: string;
	controls: string;
}) {
	return (
		<Hint label={label}>
			<button
				type="button"
				aria-label={label}
				aria-expanded={pressed}
				aria-controls={controls}
				disabled={disabled}
				onClick={onToggle}
				className={cn(
					"flex size-7 shrink-0 items-center justify-center rounded-control transition-colors duration-(--dur-instant) hover:bg-surface-3 disabled:opacity-50",
					pressed ? "bg-surface-3 text-text-1" : "bg-surface-2 text-text-2",
				)}
				data-testid={testId}
			>
				{icon}
			</button>
		</Hint>
	);
}
