// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as React from "react";

import { cn } from "@/lib/utils";

/** A raised surface: board cards, the box, popovers and dialogs only (study-v2 §2.5). */

const Surface = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		className={cn("raised rounded-surface text-text-1", className)}
		{...props}
	/>
));
Surface.displayName = "Surface";

const SurfaceHeader = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		className={cn("flex flex-col space-y-1 p-4", className)}
		{...props}
	/>
));
SurfaceHeader.displayName = "SurfaceHeader";

const SurfaceTitle = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div ref={ref} className={cn("text-heading", className)} {...props} />
));
SurfaceTitle.displayName = "SurfaceTitle";

const SurfaceDescription = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		className={cn("text-body text-text-2", className)}
		{...props}
	/>
));
SurfaceDescription.displayName = "SurfaceDescription";

const SurfaceContent = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div ref={ref} className={cn("p-4 pt-0 text-body", className)} {...props} />
));
SurfaceContent.displayName = "SurfaceContent";

const SurfaceFooter = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		className={cn("flex items-center p-4 pt-0", className)}
		{...props}
	/>
));
SurfaceFooter.displayName = "SurfaceFooter";

export {
	Surface,
	SurfaceContent,
	SurfaceDescription,
	SurfaceFooter,
	SurfaceHeader,
	SurfaceTitle,
};
