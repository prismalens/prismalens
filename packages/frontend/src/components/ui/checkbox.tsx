// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
	React.ElementRef<typeof CheckboxPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
	<CheckboxPrimitive.Root
		ref={ref}
		className={cn(
			"peer grid size-4 shrink-0 place-content-center rounded-[4px] bg-track transition-colors duration-(--dur-instant) disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-ok data-[state=checked]:text-canvas",
			className,
		)}
		{...props}
	>
		<CheckboxPrimitive.Indicator
			className={cn("grid place-content-center text-current")}
		>
			<Check className="size-[11px]" strokeWidth={2.5} />
		</CheckboxPrimitive.Indicator>
	</CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
