// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/** An on/off setting: the track fills with the accent when on. */
function Switch({
	className,
	...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(
				"peer inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-surface-4 p-0.5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent motion-reduce:transition-none",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className="pointer-events-none block size-4 rounded-full bg-text-2 shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-4 data-[state=checked]:bg-accent-fg motion-reduce:transition-none"
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
