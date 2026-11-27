// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	createToaster,
	Toast as SdkToast,
	ToastClose as SdkToastClose,
	ToastDescription as SdkToastDescription,
	ToastRegion as SdkToastRegion,
	ToastTitle as SdkToastTitle,
} from "@ui-sdk/react/toast";
import { X } from "lucide-react";
import * as React from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const appToaster = createToaster<React.ReactNode>();

export function Toaster() {
	const { toasts, dismiss } = useToast();
	const syncedIds = React.useRef(new Map<string, string>());

	React.useEffect(() => {
		const activeIds = new Set(
			toasts.filter((t) => t.open !== false).map((t) => t.id),
		);
		for (const [localId, sdkId] of Array.from(syncedIds.current.entries())) {
			if (!activeIds.has(localId)) {
				appToaster.dismiss(sdkId);
				syncedIds.current.delete(localId);
			}
		}
		for (const t of toasts) {
			if (t.open === false || syncedIds.current.has(t.id)) continue;
			const sdkId = appToaster(t.title ?? "", {
				description: t.description,
				duration: t.duration ?? (t.action ? 8000 : 4000),
				type: t.variant === "destructive" ? "error" : "info",
				data: {
					variant: t.variant ?? "default",
					action: t.action,
					localId: t.id,
				},
				onDismiss: () => {
					syncedIds.current.delete(t.id);
					dismiss(t.id);
				},
			});
			syncedIds.current.set(t.id, sdkId);
		}
	}, [toasts, dismiss]);

	return (
		<SdkToastRegion
			toaster={appToaster}
			side="bottom"
			align="end"
			className="fixed right-0 bottom-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 outline-none md:max-w-[420px]"
		>
			{(toastData) => {
				const meta = (toastData.data ?? {}) as {
					variant?: "default" | "neutral" | "destructive";
					action?: React.ReactNode;
				};
				const variant = meta.variant ?? "default";
				return (
					<SdkToast
						data-float="toast"
						className={cn(
							"group pointer-events-auto relative ml-auto flex min-h-9 w-fit max-w-full items-center gap-2.5 rounded-surface py-2 pr-8 pl-3 floating text-text-1 before:h-3 before:w-[3px] before:shrink-0 before:rounded-full",
							variant === "default" && "before:bg-ok",
							variant === "neutral" && "before:bg-text-3",
							variant === "destructive" && "destructive before:bg-danger",
						)}
					>
						<div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
							{toastData.title && (
								<SdkToastTitle className="text-body font-medium" />
							)}
							{toastData.description && (
								<SdkToastDescription className="text-body text-text-2" />
							)}
						</div>
						{meta.action}
						<SdkToastClose
							aria-label="Close"
							className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-control p-1 text-text-3 opacity-0 transition-opacity duration-(--dur-fast) hover:text-text-1 focus:opacity-100 group-hover:opacity-100"
						>
							<X className="size-3.5" aria-hidden="true" />
						</SdkToastClose>
					</SdkToast>
				);
			}}
		</SdkToastRegion>
	);
}
