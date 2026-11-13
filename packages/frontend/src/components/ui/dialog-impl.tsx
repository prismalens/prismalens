// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { useHeightLock } from "@/hooks/use-height-lock";
import { cn } from "@/lib/utils";

import { DIALOG_PANEL, DIALOG_WIDTH } from "./dialog";

// The dialog's Radix half: loaded the first time a dialog opens (#1101 category 12).

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
		/** Fit the content as it changes (the palette); other dialogs never shrink. */
		fit?: boolean;
	}
>(({ className, children, size = "md", fit = false, ...props }, ref) => {
	const lockRef = useHeightLock(ref);
	return (
		<DialogPortal>
			<DialogOverlay />
			<DialogPrimitive.Content
				ref={fit ? ref : lockRef}
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

/** The bare content and title, for a sheet that styles its own box (PanelShell). */
const DialogRawContent = DialogPrimitive.Content;
const DialogRawTitle = DialogPrimitive.Title;
const DialogRawDescription = DialogPrimitive.Description;
const DialogRawOverlay = DialogPrimitive.Overlay;
const DialogRawClose = DialogPrimitive.Close;

export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogOverlay,
	DialogPortal,
	DialogRawClose,
	DialogRawContent,
	DialogRawDescription,
	DialogRawOverlay,
	DialogRawTitle,
	DialogTitle,
	DialogTrigger,
};
