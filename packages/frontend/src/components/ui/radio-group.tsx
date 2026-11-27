// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Radio as SdkRadio,
	RadioGroup as SdkRadioGroup,
	RadioIndicator as SdkRadioIndicator,
} from "@ui-sdk/react/radio";
import { Circle } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const RadioGroup = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkRadioGroup>
>(({ className, ...props }, ref) => {
	return (
		<SdkRadioGroup
			className={cn("grid gap-2", className)}
			{...props}
			ref={ref}
		/>
	);
});
RadioGroup.displayName = "RadioGroup";

const RadioGroupItem = React.forwardRef<
	HTMLButtonElement,
	React.ComponentProps<typeof SdkRadio>
>(({ className, ...props }, ref) => {
	return (
		<SdkRadio
			ref={ref}
			className={cn(
				"aspect-square h-4 w-4 rounded-full border border-accent text-accent shadow focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50",
				className,
			)}
			{...props}
		>
			<SdkRadioIndicator className="flex items-center justify-center">
				<Circle className="h-3.5 w-3.5 fill-accent" aria-hidden="true" />
			</SdkRadioIndicator>
		</SdkRadio>
	);
});
RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };
