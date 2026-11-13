// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type * as DialogPrimitive from "@radix-ui/react-dialog";
import * as Slot from "@radix-ui/react-slot";
import * as React from "react";
import { lazyModule } from "@/lib/lazy";
import { cn } from "@/lib/utils";

/** Fixed widths (look ruling §2); a dialog never resizes to its content's width. `xl` is the larger preview's only (ruling 18). */
export const DIALOG_WIDTH = {
	sm: "w-[min(400px,calc(100%-2rem))]",
	md: "w-[min(480px,calc(100%-2rem))]",
	lg: "w-[min(640px,calc(100%-2rem))]",
	xl: "w-[min(1040px,calc(100%-64px))]",
} as const;
export const DIALOG_PANEL =
	"floating fixed top-[50%] left-[50%] z-50 grid max-h-[80dvh] translate-x-[-50%] translate-y-[-50%] content-start gap-4 overflow-y-auto rounded-dialog p-5 outline-none";

type Impl = typeof import("./dialog-impl");
/** The Radix half loads the first time a dialog opens; a closed one draws only its trigger (#1101 category 12). */
export const dialogImpl = lazyModule<Impl>(() => import("./dialog-impl"));
const ImplContext = React.createContext<Impl | null>(null);
const OpenContext = React.createContext<((open: boolean) => void) | null>(null);

function Dialog({
	open,
	defaultOpen,
	onOpenChange,
	modal,
	children,
}: DialogPrimitive.DialogProps) {
	const [inner, setInner] = React.useState(!!defaultOpen);
	const isOpen = open ?? inner;
	const I = dialogImpl.useLoaded(isOpen);
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
			<I.Dialog open={isOpen} onOpenChange={set} modal={modal}>
				{children}
			</I.Dialog>
		</ImplContext.Provider>
	);
}

/** Opens the dialog; before its code loads, a press asks for it and opens once it lands. */
const DialogTrigger = React.forwardRef<
	HTMLButtonElement,
	React.ComponentPropsWithoutRef<Impl["DialogTrigger"]>
>(({ asChild, onClick, ...props }, ref) => {
	const I = React.useContext(ImplContext);
	const open = React.useContext(OpenContext);
	if (I)
		return (
			<I.DialogTrigger
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
DialogTrigger.displayName = "DialogTrigger";

/** A part drawn through the loaded Radix half; nothing while it loads, which is while closed. */
function part<K extends Exclude<keyof Impl, "Dialog" | "DialogTrigger">>(
	name: K,
) {
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

const DialogPortal = part("DialogPortal");
const DialogClose = part("DialogClose");
const DialogOverlay = part("DialogOverlay");
const DialogContent = part("DialogContent");
const DialogTitle = part("DialogTitle");
const DialogDescription = part("DialogDescription");
const DialogRawContent = part("DialogRawContent");
const DialogRawTitle = part("DialogRawTitle");
const DialogRawDescription = part("DialogRawDescription");
const DialogRawOverlay = part("DialogRawOverlay");
const DialogRawClose = part("DialogRawClose");

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

export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
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
