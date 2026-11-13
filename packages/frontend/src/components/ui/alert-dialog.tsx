// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as Slot from "@radix-ui/react-slot";
import * as React from "react";
import { lazyModule } from "@/lib/lazy";
import { cn } from "@/lib/utils";

type Impl = typeof import("./alert-dialog-impl");
/** The Radix half loads the first time an alert dialog opens (#1101 category 12). */
export const alertDialogImpl = lazyModule<Impl>(
	() => import("./alert-dialog-impl"),
);
const ImplContext = React.createContext<Impl | null>(null);
const OpenContext = React.createContext<((open: boolean) => void) | null>(null);

function AlertDialog({
	open,
	defaultOpen,
	onOpenChange,
	children,
}: AlertDialogPrimitive.AlertDialogProps) {
	const [inner, setInner] = React.useState(!!defaultOpen);
	const isOpen = open ?? inner;
	const I = alertDialogImpl.useLoaded(isOpen);
	const set = React.useCallback(
		(next: boolean) => {
			setInner(next);
			onOpenChange?.(next);
		},
		[onOpenChange],
	);
	if (!I)
		return <OpenContext.Provider value={set}>{children}</OpenContext.Provider>;
	return (
		<ImplContext.Provider value={I}>
			<I.AlertDialog open={isOpen} onOpenChange={set}>
				{children}
			</I.AlertDialog>
		</ImplContext.Provider>
	);
}

/** Opens the alert; before its code loads, a press asks for it and opens once it lands. */
const AlertDialogTrigger = React.forwardRef<
	HTMLButtonElement,
	React.ComponentPropsWithoutRef<Impl["AlertDialogTrigger"]>
>(({ asChild, onClick, ...props }, ref) => {
	const I = React.useContext(ImplContext);
	const open = React.useContext(OpenContext);
	if (I)
		return (
			<I.AlertDialogTrigger
				ref={ref}
				asChild={asChild}
				onClick={onClick}
				{...props}
			/>
		);
	const Comp = asChild ? Slot.Root : "button";
	return (
		<Comp
			ref={ref}
			{...props}
			onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
				onClick?.(e);
				if (!e.defaultPrevented) open?.(true);
			}}
		/>
	);
});
AlertDialogTrigger.displayName = "AlertDialogTrigger";

/** A part drawn through the loaded Radix half; nothing while it loads, which is while closed. */
function part<
	K extends Exclude<keyof Impl, "AlertDialog" | "AlertDialogTrigger">,
>(name: K) {
	const Part = React.forwardRef<
		HTMLElement,
		React.ComponentPropsWithoutRef<Impl[K]>
	>((props, ref) => {
		const I = React.useContext(ImplContext);
		if (!I) return null;
		return React.createElement(I[name] as React.ElementType, { ...props, ref });
	});
	Part.displayName = name;
	return Part;
}

const AlertDialogPortal = part("AlertDialogPortal");
const AlertDialogOverlay = part("AlertDialogOverlay");
const AlertDialogContent = part("AlertDialogContent");
const AlertDialogTitle = part("AlertDialogTitle");
const AlertDialogDescription = part("AlertDialogDescription");
const AlertDialogAction = part("AlertDialogAction");
const AlertDialogCancel = part("AlertDialogCancel");

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

export {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogOverlay,
	AlertDialogPortal,
	AlertDialogTitle,
	AlertDialogTrigger,
};
