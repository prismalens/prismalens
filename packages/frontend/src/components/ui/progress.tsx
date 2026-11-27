// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Progress as SdkProgress,
	ProgressIndicator as SdkProgressIndicator,
	ProgressTrack as SdkProgressTrack,
} from "@ui-sdk/react/progress";
import * as React from "react";

import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkProgress>
>(({ className, value, ...props }, ref) => (
	<SdkProgress
		ref={ref}
		value={value}
		className={cn(
			"relative h-2 w-full overflow-hidden rounded-full bg-accent/20",
			className,
		)}
		{...props}
	>
		<SdkProgressTrack className="h-full w-full">
			<SdkProgressIndicator
				className="h-full w-full flex-1 bg-accent transition-all motion-reduce:transition-none"
				style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
			/>
		</SdkProgressTrack>
	</SdkProgress>
));
Progress.displayName = "Progress";

export { Progress };
