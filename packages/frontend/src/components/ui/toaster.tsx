// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import {
	Toast,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
} from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";

/** The corner's slot for cards that stay until dismissed, such as the restart card. */
export const FLOAT_CARDS_ID = "float-cards";

/**
 * The app's one toast provider and its one viewport, the page's only "Notifications"
 * landmark: other toasts (AttentionRuntime) render inside `children` into the same list.
 */
export function Toaster({ children }: { children?: ReactNode }) {
	const { toasts } = useToast();

	return (
		<ToastProvider>
			{children}
			{toasts.map(({ id, title, description, action, duration, ...props }) => (
				// 4 s, or 8 s when it carries an action; Radix pauses it on hover and focus.
				<Toast
					key={id}
					duration={duration ?? (action ? 8000 : 4000)}
					{...props}
				>
					<div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
						{title && <ToastTitle>{title}</ToastTitle>}
						{description && <ToastDescription>{description}</ToastDescription>}
					</div>
					{action}
					<ToastClose />
				</Toast>
			))}
			{/* One corner for every floating card and toast, stacked so none covers another. */}
			<div
				className="pointer-events-none fixed right-0 bottom-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 md:max-w-[420px]"
				data-testid="float-region"
			>
				<div
					id={FLOAT_CARDS_ID}
					className="pointer-events-auto flex flex-col gap-2 empty:hidden"
				/>
				<ToastViewport className="pointer-events-auto static z-auto max-h-none p-0" />
			</div>
		</ToastProvider>
	);
}
