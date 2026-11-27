// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import {
	Drawer as SdkDrawer,
	DrawerBackdrop as SdkDrawerBackdrop,
	DrawerClose as SdkDrawerClose,
	DrawerContent as SdkDrawerContent,
	DrawerDescription as SdkDrawerDescription,
	DrawerTitle as SdkDrawerTitle,
	DrawerTrigger as SdkDrawerTrigger,
} from "@ui-sdk/react/drawer";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const Sheet = SdkDrawer;
const SheetTrigger = SdkDrawerTrigger;
const SheetClose = SdkDrawerClose;

const SheetOverlay = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkDrawerBackdrop>
>(({ className, ...props }, ref) => (
	<SdkDrawerBackdrop
		className={cn(
			"fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0",
			className,
		)}
		{...props}
		ref={ref}
	/>
));
SheetOverlay.displayName = "SheetOverlay";

const sheetVariants = cva(
	"floating fixed z-50 gap-4 p-5 transition-transform ease-in-out data-closed:duration-150 data-open:duration-200",
	{
		variants: {
			side: {
				top: "inset-x-0 top-0 data-starting-style:-translate-y-full data-ending-style:-translate-y-full",
				bottom:
					"inset-x-0 bottom-0 data-starting-style:translate-y-full data-ending-style:translate-y-full",
				left: "inset-y-0 left-0 h-full w-3/4 sm:max-w-sm data-starting-style:-translate-x-full data-ending-style:-translate-x-full",
				right:
					"inset-y-0 right-0 h-full w-3/4 sm:max-w-sm data-starting-style:translate-x-full data-ending-style:translate-x-full",
			},
		},
		defaultVariants: {
			side: "right",
		},
	},
);

interface SheetContentProps
	extends Omit<React.ComponentProps<typeof SdkDrawerContent>, "children">,
		VariantProps<typeof sheetVariants> {
	children?: React.ReactNode;
}

const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
	({ side = "right", className, children, ...props }, ref) => (
		<>
			<SheetOverlay />
			<SdkDrawerContent
				ref={ref}
				className={cn(sheetVariants({ side }), className)}
				{...props}
			>
				<SdkDrawerClose
					aria-label="Close"
					className="absolute right-3 top-3 inline-flex size-7 items-center justify-center rounded-control text-text-3 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none"
				>
					<X className="h-4 w-4" aria-hidden="true" />
				</SdkDrawerClose>
				{children}
			</SdkDrawerContent>
		</>
	),
);
SheetContent.displayName = "SheetContent";

const SheetHeader = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("flex flex-col gap-1 text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
			className,
		)}
		{...props}
	/>
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
	HTMLHeadingElement,
	React.ComponentProps<typeof SdkDrawerTitle>
>(({ className, ...props }, ref) => (
	<SdkDrawerTitle
		ref={ref}
		className={cn("text-title", className)}
		{...props}
	/>
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = React.forwardRef<
	HTMLParagraphElement,
	React.ComponentProps<typeof SdkDrawerDescription>
>(({ className, ...props }, ref) => (
	<SdkDrawerDescription
		ref={ref}
		className={cn("text-body text-text-2", className)}
		{...props}
	/>
));
SheetDescription.displayName = "SheetDescription";

export {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetOverlay,
	SheetTitle,
	SheetTrigger,
};
