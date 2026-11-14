// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SurfaceDef } from "./actions";

/**
 * The rows right-click, Shift+F10 and the Menu key open: the surface's `context` list, or
 * its `more` list when it declares only that, so no registered menu is pointer-only (#1101).
 */
export function contextIds(surface: Pick<SurfaceDef, "menus"> | undefined) {
	const m = surface?.menus;
	return (m?.context?.length ? m.context : m?.more) ?? [];
}
