// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Switch as SdkSwitch,
	SwitchThumb as SdkSwitchThumb,
} from "@ui-sdk/react/switch";
import type * as React from "react";

import { cn } from "@/lib/utils";

/** An on/off setting: the track fills with the accent when on; off sits on --track. */
function Switch({
	className,
	...props
}: React.ComponentProps<typeof SdkSwitch>) {
	return (
		<SdkSwitch
			className={cn(
				"peer inline-flex h-5 w-[34px] shrink-0 items-center rounded-full bg-track p-0.5 transition-colors duration-(--dur-fast) ease-(--ease-standard) disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-checked:bg-accent-solid",
				className,
			)}
			{...props}
		>
			<SdkSwitchThumb className="pointer-events-none block size-4 rounded-full bg-surface-2 shadow-[0_1px_2px_oklch(0_0_0/0.3)] transition-[translate,background-color] duration-(--dur-fast) ease-(--ease-out) data-checked:translate-x-3.5 data-checked:bg-accent-fg" />
		</SdkSwitch>
	);
}

export { Switch };
