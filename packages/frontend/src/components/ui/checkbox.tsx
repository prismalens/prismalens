// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Checkbox as SdkCheckbox,
	CheckboxIndicator as SdkCheckboxIndicator,
} from "@ui-sdk/react/checkbox";
import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
	HTMLButtonElement,
	React.ComponentProps<typeof SdkCheckbox>
>(({ className, ...props }, ref) => (
	<SdkCheckbox
		ref={ref}
		className={cn(
			"peer grid size-4 shrink-0 place-content-center rounded-[4px] bg-track transition-colors duration-(--dur-instant) disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-checked:bg-ok data-checked:text-canvas",
			className,
		)}
		{...props}
	>
		<SdkCheckboxIndicator className="grid place-content-center text-current">
			<Check className="size-[11px]" strokeWidth={2.5} aria-hidden="true" />
		</SdkCheckboxIndicator>
	</SdkCheckbox>
));
Checkbox.displayName = "Checkbox";

export { Checkbox };
