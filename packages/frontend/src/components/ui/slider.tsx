// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Slider as SdkSlider,
	SliderControl as SdkSliderControl,
	SliderIndicator as SdkSliderIndicator,
	SliderThumb as SdkSliderThumb,
	SliderTrack as SdkSliderTrack,
} from "@ui-sdk/react/slider";
import * as React from "react";

import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkSlider>
>(({ className, ...props }, ref) => (
	<SdkSlider
		ref={ref}
		className={cn(
			"relative flex w-full touch-none select-none items-center",
			className,
		)}
		{...props}
	>
		<SdkSliderControl className="relative flex w-full items-center">
			<SdkSliderTrack className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-accent/20">
				<SdkSliderIndicator className="absolute h-full bg-accent" />
			</SdkSliderTrack>
			<SdkSliderThumb className="block h-4 w-4 rounded-full border border-accent/50 bg-canvas shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50" />
		</SdkSliderControl>
	</SdkSlider>
));
Slider.displayName = "Slider";

export { Slider };
