// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as SwitchPrimitive from "@radix-ui/react-switch";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * An on/off setting: the track fills with the accent when on; off sits on --track.
 * The box is 24 px (44 px on a phone) with the 34x20 track painted in its content box,
 * so the target meets the size floor without a bigger track (#1101 bar 5.7).
 */
function Switch({
	className,
	...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(
				"peer inline-flex h-6 w-[38px] shrink-0 items-center rounded-full bg-track bg-clip-content p-0.5 transition-colors duration-(--dur-fast) ease-(--ease-standard) disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent-solid max-sm:h-11 max-sm:w-11 max-sm:bg-clip-content max-sm:px-[5px] max-sm:py-3",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className="pointer-events-none block size-4 rounded-full bg-surface-2 shadow-[0_1px_2px_oklch(0_0_0/0.3)] transition-[translate,background-color] duration-(--dur-fast) ease-(--ease-out) data-[state=checked]:translate-x-3.5 data-[state=checked]:bg-accent-fg mx-0.5"
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
