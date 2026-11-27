// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	AlertDialog as SdkAlertDialog,
	AlertDialogBackdrop as SdkAlertDialogBackdrop,
	AlertDialogClose as SdkAlertDialogClose,
	AlertDialogContent as SdkAlertDialogContent,
	AlertDialogDescription as SdkAlertDialogDescription,
	AlertDialogTitle as SdkAlertDialogTitle,
	AlertDialogTrigger as SdkAlertDialogTrigger,
} from "@ui-sdk/react/alert-dialog";
import * as React from "react";
import { buttonVariants } from "@/components/ui/button";
import { DIALOG_PANEL, DIALOG_WIDTH } from "@/components/ui/dialog";
import { useHeightLock } from "@/hooks/use-height-lock";
import { cn } from "@/lib/utils";

const AlertDialog = SdkAlertDialog;
const AlertDialogTrigger = SdkAlertDialogTrigger;

const AlertDialogOverlay = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkAlertDialogBackdrop>
>(({ className, ...props }, ref) => (
	<SdkAlertDialogBackdrop
		data-float="scrim"
		className={cn("fixed inset-0 z-50 bg-scrim", className)}
		{...props}
		ref={ref}
	/>
));
AlertDialogOverlay.displayName = "AlertDialogOverlay";

const AlertDialogContent = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkAlertDialogContent> & {
		size?: keyof typeof DIALOG_WIDTH;
	}
>(({ className, size = "sm", ...props }, ref) => {
	const lockRef = useHeightLock(ref);
	return (
		<>
			<AlertDialogOverlay />
			<SdkAlertDialogContent
				ref={lockRef}
				data-float="dialog"
				className={cn(DIALOG_PANEL, DIALOG_WIDTH[size], className)}
				{...props}
			/>
		</>
	);
});
AlertDialogContent.displayName = "AlertDialogContent";

const AlertDialogHeader = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("flex flex-col gap-1 text-left", className)} {...props} />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogFooter = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn("flex flex-wrap justify-end gap-2 pt-1", className)}
		{...props}
	/>
);
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
	HTMLHeadingElement,
	React.ComponentProps<typeof SdkAlertDialogTitle>
>(({ className, ...props }, ref) => (
	<SdkAlertDialogTitle
		ref={ref}
		className={cn("text-title", className)}
		{...props}
	/>
));
AlertDialogTitle.displayName = "AlertDialogTitle";

const AlertDialogDescription = React.forwardRef<
	HTMLParagraphElement,
	React.ComponentProps<typeof SdkAlertDialogDescription>
>(({ className, ...props }, ref) => (
	<SdkAlertDialogDescription
		ref={ref}
		className={cn("text-body text-text-2", className)}
		{...props}
	/>
));
AlertDialogDescription.displayName = "AlertDialogDescription";

const AlertDialogAction = React.forwardRef<
	HTMLButtonElement,
	Omit<React.ComponentProps<typeof SdkAlertDialogClose>, "onClick"> & {
		onClick?: React.MouseEventHandler<HTMLButtonElement>;
	}
>(({ className, onClick, ...props }, ref) => (
	<SdkAlertDialogClose
		ref={ref}
		value="confirm"
		className={cn(buttonVariants(), className)}
		onClick={
			onClick as unknown as React.ComponentProps<
				typeof SdkAlertDialogClose
			>["onClick"]
		}
		{...props}
	/>
));
AlertDialogAction.displayName = "AlertDialogAction";

const AlertDialogCancel = React.forwardRef<
	HTMLButtonElement,
	Omit<React.ComponentProps<typeof SdkAlertDialogClose>, "onClick"> & {
		onClick?: React.MouseEventHandler<HTMLButtonElement>;
	}
>(({ className, onClick, ...props }, ref) => (
	<SdkAlertDialogClose
		ref={ref}
		className={cn(buttonVariants({ variant: "secondary" }), className)}
		onClick={
			onClick as unknown as React.ComponentProps<
				typeof SdkAlertDialogClose
			>["onClick"]
		}
		{...props}
	/>
));
AlertDialogCancel.displayName = "AlertDialogCancel";

export {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogOverlay,
	AlertDialogTitle,
	AlertDialogTrigger,
};
