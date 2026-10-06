// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as DialogPrimitive from "@radix-ui/react-dialog";
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

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Overlay
		ref={ref}
		data-float="scrim"
		className={cn("fixed inset-0 z-50 bg-scrim", className)}
		{...props}
	/>
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
		size?: keyof typeof DIALOG_WIDTH;
	}
>(({ className, children, size = "md", ...props }, ref) => {
	const lockRef = useHeightLock(ref);
	return (
		<DialogPortal>
			<DialogOverlay />
			<DialogPrimitive.Content
				ref={lockRef}
				data-float="dialog"
				className={cn(DIALOG_PANEL, DIALOG_WIDTH[size], className)}
				{...props}
			>
				{children}
				<DialogPrimitive.Close className="absolute top-3 right-3 inline-flex size-7 items-center justify-center rounded-control text-text-3 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1 disabled:pointer-events-none">
					<X className="size-4" />
					<span className="sr-only">Close</span>
				</DialogPrimitive.Close>
			</DialogPrimitive.Content>
		</DialogPortal>
	);
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

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
	React.ElementRef<typeof DialogPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Title
		ref={ref}
		className={cn("text-title", className)}
		{...props}
	/>
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Description
		ref={ref}
		className={cn("text-body text-text-2", className)}
		{...props}
	/>
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

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
