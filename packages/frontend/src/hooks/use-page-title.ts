// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect } from "react";

/**
 * The browser tab and the desktop window title. Call it from the leaf that
 * owns the page: a parent's effect runs after its child's and would win.
 */
export function usePageTitle(title: string | null | undefined): void {
	useEffect(() => {
		document.title = title ? `${title} · PrismaLens` : "PrismaLens";
	}, [title]);
}
