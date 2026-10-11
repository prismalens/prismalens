// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect } from "react";

/** Esc is the back chevron on a record (#743, #811), unless a field, dialog, menu or panel has it. */
export function useEscapeBack(back: () => void) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented) return;
			const t = e.target as HTMLElement | null;
			if (
				t?.tagName === "INPUT" ||
				t?.tagName === "TEXTAREA" ||
				t?.tagName === "SELECT" ||
				t?.isContentEditable
			)
				return;
			if (
				document.querySelector(
					"[role=dialog], [role=alertdialog], [role=menu], [data-radix-popper-content-wrapper]",
				)
			)
				return;
			back();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [back]);
}
