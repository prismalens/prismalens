// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type ReactNode, useEffect } from "react";
import { lazyPart } from "@/lib/lazy";

/** The corner's slot for cards that stay until dismissed, such as the restart card. */
export const FLOAT_CARDS_ID = "float-cards";
/** Where the toast layer puts its one viewport, under the floating cards. */
export const TOAST_SLOT_ID = "toast-slot";

// Every toast is raised after first content, so the toast code loads then (#1101 category 12);
// a toast raised before it waits in the store and shows once the layer is in.
const ToastLayer = lazyPart(
	() => import("./toast-layer").then((m) => m.ToastLayer),
	null,
	{ afterFirstContent: true, failed: (retry) => <RetryLoad retry={retry} /> },
);

/** A failed load (a dropped link) tries again when the browser is back online, or in 10 s. */
function RetryLoad({ retry }: { retry: () => void }) {
	useEffect(() => {
		const t = setTimeout(retry, 10_000);
		window.addEventListener("online", retry);
		return () => {
			clearTimeout(t);
			window.removeEventListener("online", retry);
		};
	}, [retry]);
	return null;
}

/**
 * The app's one toast list, the page's only "Notifications" landmark, and the corner
 * every floating card and toast stacks in, so none covers another.
 */
export function Toaster({ children }: { children?: ReactNode }) {
	return (
		<>
			{children}
			<div
				className="pointer-events-none fixed right-0 bottom-(--toast-clear,0px) z-[100] flex max-h-screen w-full flex-col gap-2 p-4 md:max-w-[420px]"
				data-testid="float-region"
			>
				<div
					id={FLOAT_CARDS_ID}
					className="pointer-events-auto flex flex-col gap-2 empty:hidden"
				/>
				<div id={TOAST_SLOT_ID} className="contents" />
			</div>
			<ToastLayer />
		</>
	);
}
