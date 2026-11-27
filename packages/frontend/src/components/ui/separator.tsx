// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Separator as SdkSeparator } from "@ui-sdk/react/separator";
import * as React from "react";

import { cn } from "@/lib/utils";

const Separator = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkSeparator>
>(({ className, orientation = "horizontal", ...props }, ref) => (
	<SdkSeparator
		ref={ref}
		orientation={orientation}
		className={cn(
			"shrink-0 bg-hairline",
			orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
			className,
		)}
		{...props}
	/>
));
Separator.displayName = "Separator";

export { Separator };
