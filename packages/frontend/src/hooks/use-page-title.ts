// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect } from "react";
import { titleWithCount, useNeedsCount } from "@/lib/attention/needs-count";

/**
 * The browser tab and the desktop window title, led by the needs-you count. Call it
 * from the leaf that owns the page: a parent's effect runs after its child's and would win.
 */
export function usePageTitle(title: string | null | undefined): void {
	const n = useNeedsCount();
	useEffect(() => {
		document.title = titleWithCount(title, n);
	}, [title, n]);
}
