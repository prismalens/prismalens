// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Dialog as SdkDialog,
	DialogBackdrop as SdkDialogBackdrop,
	DialogClose as SdkDialogClose,
	DialogContent as SdkDialogContent,
	DialogDescription as SdkDialogDescription,
	DialogTitle as SdkDialogTitle,
	DialogTrigger as SdkDialogTrigger,
} from "@ui-sdk/react/dialog";
import { X } from "lucide-react";
import * as React from "react";

import { useHeightLock } from "@/hooks/use-height-lock";
import { cn } from "@/lib/utils";

/** Three fixed widths (look ruling §2); a dialog never resizes to its content's width. */
export const DIALOG_WIDTH = {
	sm: "w-[min(400px,calc(100%-2rem))]",
	md: "w-[min(480px,calc(100%-2rem))]",
	lg: "w-[min(640px,calc(100%-2rem))]",
} as const;
export const DIALOG_PANEL =
	"floating fixed top-[50%] left-[50%] z-50 grid max-h-[80dvh] translate-x-[-50%] translate-y-[-50%] content-start gap-4 overflow-y-auto rounded-dialog p-5 outline-none";

const Dialog = SdkDialog;

function DialogTrigger({
	asChild = false,
	children,
	render,
	...props
}: React.ComponentProps<typeof SdkDialogTrigger> & { asChild?: boolean }) {
	const resolvedRender =
		render ??
		(asChild && React.isValidElement(children) ? children : undefined);
	const resolvedChildren =
		asChild && React.isValidElement(children) ? undefined : children;
	return (
		<SdkDialogTrigger render={resolvedRender} {...props}>
			{resolvedChildren}
		</SdkDialogTrigger>
	);
}

const DialogPortal = ({ children }: { children?: React.ReactNode }) => (
	<>{children}</>
);

function DialogClose({
	asChild = false,
	children,
	render,
	...props
}: React.ComponentProps<typeof SdkDialogClose> & { asChild?: boolean }) {
	const resolvedRender =
		render ??
		(asChild && React.isValidElement(children) ? children : undefined);
	const resolvedChildren =
		asChild && React.isValidElement(children) ? undefined : children;
	return (
		<SdkDialogClose render={resolvedRender} {...props}>
			{resolvedChildren}
		</SdkDialogClose>
	);
}

const DialogOverlay = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkDialogBackdrop>
>(({ className, ...props }, ref) => (
	<SdkDialogBackdrop
		ref={ref}
		data-float="scrim"
		className={cn("fixed inset-0 z-50 bg-scrim", className)}
		{...props}
	/>
));
DialogOverlay.displayName = "DialogOverlay";

const DialogContent = React.forwardRef<
	HTMLDivElement,
	Omit<React.ComponentProps<typeof SdkDialogContent>, "children"> & {
		size?: keyof typeof DIALOG_WIDTH;
		children?: React.ReactNode;
	}
>(({ className, children, size = "md", ...props }, ref) => {
	const lockRef = useHeightLock(ref);
	return (
		<>
			<DialogOverlay />
			<SdkDialogContent
				ref={lockRef}
				data-float="dialog"
				className={cn(DIALOG_PANEL, DIALOG_WIDTH[size], className)}
				{...props}
			>
				{children}
				<SdkDialogClose
					aria-label="Close"
					className="absolute top-3 right-3 inline-flex size-7 items-center justify-center rounded-control text-text-3 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1 disabled:pointer-events-none"
				>
					<X className="size-4" aria-hidden="true" />
				</SdkDialogClose>
			</SdkDialogContent>
		</>
	);
});
DialogContent.displayName = "DialogContent";

const DialogHeader = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn("flex flex-col gap-1 pr-8 text-left", className)}
		{...props}
	/>
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn("flex flex-wrap justify-end gap-2 pt-1", className)}
		{...props}
	/>
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
	HTMLHeadingElement,
	React.ComponentProps<typeof SdkDialogTitle>
>(({ className, ...props }, ref) => (
	<SdkDialogTitle
		ref={ref}
		className={cn("text-title", className)}
		{...props}
	/>
));
DialogTitle.displayName = "DialogTitle";

const DialogDescription = React.forwardRef<
	HTMLParagraphElement,
	React.ComponentProps<typeof SdkDialogDescription> & { asChild?: boolean }
>(({ className, asChild = false, children, render, ...props }, ref) => {
	const resolvedRender =
		render ??
		(asChild && React.isValidElement(children) ? children : undefined);
	const resolvedChildren =
		asChild && React.isValidElement(children) ? undefined : children;
	return (
		<SdkDialogDescription
			ref={ref}
			className={cn("text-body text-text-2", className)}
			render={resolvedRender}
			{...props}
		>
			{resolvedChildren}
		</SdkDialogDescription>
	);
});
DialogDescription.displayName = "DialogDescription";

export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
};
