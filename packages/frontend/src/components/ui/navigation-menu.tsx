// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	NavigationMenu as SdkNavigationMenu,
	NavigationMenuContent as SdkNavigationMenuContent,
	NavigationMenuIndicator as SdkNavigationMenuIndicator,
	NavigationMenuItem as SdkNavigationMenuItem,
	NavigationMenuLink as SdkNavigationMenuLink,
	NavigationMenuList as SdkNavigationMenuList,
	NavigationMenuTrigger as SdkNavigationMenuTrigger,
	NavigationMenuViewport as SdkNavigationMenuViewport,
} from "@ui-sdk/react/navigation-menu";
import { cva } from "class-variance-authority";
import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const NavigationMenu = React.forwardRef<
	HTMLElement,
	Omit<React.ComponentProps<typeof SdkNavigationMenu>, "children"> & {
		children?: React.ReactNode;
	}
>(({ className, children, ...props }, ref) => (
	<SdkNavigationMenu
		ref={ref}
		className={cn(
			"relative z-10 flex max-w-max flex-1 items-center justify-center",
			className,
		)}
		{...props}
	>
		{children}
		<NavigationMenuViewport />
	</SdkNavigationMenu>
));
NavigationMenu.displayName = "NavigationMenu";

const NavigationMenuList = React.forwardRef<
	HTMLUListElement,
	React.ComponentProps<typeof SdkNavigationMenuList>
>(({ className, ...props }, ref) => (
	<SdkNavigationMenuList
		ref={ref}
		className={cn(
			"group flex flex-1 list-none items-center justify-center space-x-1",
			className,
		)}
		{...props}
	/>
));
NavigationMenuList.displayName = "NavigationMenuList";

const NavigationMenuItem = SdkNavigationMenuItem;

const navigationMenuTriggerStyle = cva(
	"group inline-flex h-9 w-max items-center justify-center rounded-md bg-canvas px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-fg focus:bg-accent focus:text-accent-fg focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-open:bg-accent data-open:text-accent-fg",
);

const NavigationMenuTrigger = React.forwardRef<
	HTMLButtonElement,
	Omit<React.ComponentProps<typeof SdkNavigationMenuTrigger>, "children"> & {
		children?: React.ReactNode;
	}
>(({ className, children, ...props }, ref) => (
	<SdkNavigationMenuTrigger
		ref={ref}
		className={cn(navigationMenuTriggerStyle(), "group", className)}
		{...props}
	>
		{children}{" "}
		<ChevronDown
			className="relative top-[1px] ml-1 h-3 w-3 transition duration-300 group-data-open:rotate-180"
			aria-hidden="true"
		/>
	</SdkNavigationMenuTrigger>
));
NavigationMenuTrigger.displayName = "NavigationMenuTrigger";

const NavigationMenuContent = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkNavigationMenuContent>
>(({ className, ...props }, ref) => (
	<SdkNavigationMenuContent
		ref={ref}
		className={cn("left-0 top-0 w-full md:w-auto", className)}
		{...props}
	/>
));
NavigationMenuContent.displayName = "NavigationMenuContent";

const NavigationMenuLink = SdkNavigationMenuLink;

const NavigationMenuViewport = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkNavigationMenuViewport>
>(({ className, ...props }, ref) => (
	<div className={cn("absolute left-0 top-full flex justify-center")}>
		<SdkNavigationMenuViewport
			className={cn(
				"origin-top-center relative mt-1.5 h-(--viewport-height) w-full overflow-hidden rounded-pool floating text-text-1 md:w-(--viewport-width)",
				className,
			)}
			ref={ref}
			{...props}
		/>
	</div>
));
NavigationMenuViewport.displayName = "NavigationMenuViewport";

const NavigationMenuIndicator = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkNavigationMenuIndicator>
>(({ className, ...props }, ref) => (
	<SdkNavigationMenuIndicator
		ref={ref}
		className={cn(
			"top-full z-[1] flex h-1.5 items-end justify-center overflow-hidden",
			className,
		)}
		{...props}
	>
		<div className="relative top-[60%] h-2 w-2 rotate-45 rounded-tl-sm bg-hairline shadow-md" />
	</SdkNavigationMenuIndicator>
));
NavigationMenuIndicator.displayName = "NavigationMenuIndicator";

export {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuIndicator,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
	NavigationMenuViewport,
	navigationMenuTriggerStyle,
};
