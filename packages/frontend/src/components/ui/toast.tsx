// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Toast as SdkToast,
	ToastAction as SdkToastAction,
	ToastClose as SdkToastClose,
	ToastDescription as SdkToastDescription,
	ToastRegion as SdkToastRegion,
	ToastTitle as SdkToastTitle,
} from "@ui-sdk/react/toast";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const ToastProvider = ({ children }: { children?: React.ReactNode }) => (
	<>{children}</>
);

const ToastViewport = React.forwardRef<
	HTMLElement,
	React.ComponentProps<typeof SdkToastRegion>
>(({ className, ...props }, ref) => (
	<SdkToastRegion
		ref={ref as React.Ref<HTMLElement>}
		className={cn(
			"fixed right-0 bottom-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 outline-none md:max-w-[420px]",
			className,
		)}
		{...props}
	/>
));
ToastViewport.displayName = "ToastViewport";

/**
 * Floating, bottom-right: a state bar and one line (look ruling §2). The bar
 * says how it went; the words never turn red.
 */
const toastVariants = cva(
	"group pointer-events-auto relative ml-auto flex min-h-9 w-fit max-w-full items-center gap-2.5 rounded-surface py-2 pr-8 pl-3 floating text-text-1 before:h-3 before:w-[3px] before:shrink-0 before:rounded-full",
	{
		variants: {
			variant: {
				default: "before:bg-ok",
				neutral: "before:bg-text-3",
				destructive: "destructive before:bg-danger",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

type ToastProps = Omit<React.ComponentProps<typeof SdkToast>, "children"> &
	VariantProps<typeof toastVariants> & {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		duration?: number;
		children?: React.ReactNode;
	};

const Toast = React.forwardRef<HTMLLIElement, ToastProps>(
	(
		{
			className,
			variant,
			open: _open,
			onOpenChange: _onOpenChange,
			duration: _duration,
			...props
		},
		ref,
	) => {
		return (
			<SdkToast
				ref={ref}
				data-float="toast"
				className={cn(toastVariants({ variant }), className)}
				{...props}
			/>
		);
	},
);
Toast.displayName = "Toast";

const ToastAction = React.forwardRef<
	HTMLButtonElement,
	Omit<React.ComponentProps<typeof SdkToastAction>, "children"> & {
		altText?: string;
		children?: React.ReactNode;
		onClick?: React.MouseEventHandler<HTMLButtonElement>;
	}
>(({ className, altText: _altText, onClick, ...props }, ref) => (
	<SdkToastAction
		ref={ref}
		className={cn(
			"inline-flex h-6 shrink-0 items-center justify-center rounded-control bg-surface-3 px-2 text-meta font-medium transition-colors duration-(--dur-instant) hover:bg-surface-4 disabled:pointer-events-none disabled:opacity-50",
			className,
		)}
		onClick={
			onClick as unknown as React.ComponentProps<
				typeof SdkToastAction
			>["onClick"]
		}
		{...props}
	/>
));
ToastAction.displayName = "ToastAction";

const ToastClose = React.forwardRef<
	HTMLButtonElement,
	Omit<React.ComponentProps<typeof SdkToastClose>, "children"> & {
		children?: React.ReactNode;
	}
>(({ className, ...props }, ref) => (
	<SdkToastClose
		ref={ref}
		aria-label="Close"
		className={cn(
			"absolute top-1/2 right-1.5 -translate-y-1/2 rounded-control p-1 text-text-3 opacity-0 transition-opacity duration-(--dur-fast) hover:text-text-1 focus:opacity-100 group-hover:opacity-100",
			className,
		)}
		toast-close=""
		{...props}
	>
		<X className="size-3.5" aria-hidden="true" />
	</SdkToastClose>
));
ToastClose.displayName = "ToastClose";

const ToastTitle = React.forwardRef<
	HTMLDivElement,
	Omit<React.ComponentProps<typeof SdkToastTitle>, "children"> & {
		children?: React.ReactNode;
	}
>(({ className, ...props }, ref) => (
	<SdkToastTitle
		ref={ref}
		className={cn("text-body font-medium", className)}
		{...props}
	/>
));
ToastTitle.displayName = "ToastTitle";

const ToastDescription = React.forwardRef<
	HTMLDivElement,
	Omit<React.ComponentProps<typeof SdkToastDescription>, "children"> & {
		children?: React.ReactNode;
	}
>(({ className, ...props }, ref) => (
	<SdkToastDescription
		ref={ref}
		className={cn("text-body text-text-2", className)}
		{...props}
	/>
));
ToastDescription.displayName = "ToastDescription";

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
	Toast,
	ToastAction,
	type ToastActionElement,
	ToastClose,
	ToastDescription,
	type ToastProps,
	ToastProvider,
	ToastTitle,
	ToastViewport,
};
