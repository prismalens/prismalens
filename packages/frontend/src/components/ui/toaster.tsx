// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Toast,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
} from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";

export function Toaster() {
	const { toasts } = useToast();

	return (
		<ToastProvider>
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
			<ToastViewport />
		</ToastProvider>
	);
}
