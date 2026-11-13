// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SurfaceId } from "./actions";

// The focused surface, apart from the registry: a surface marks itself on the first frame,
// before the registry loads (#1101 category 12); the palette reads it later.
export interface Active {
	id: SurfaceId;
	ctx: () => unknown;
}
let active: Active | null = null;
const listeners = new Set<() => void>();
export function setActiveSurface(next: Active | null) {
	active = next;
	for (const l of Array.from(listeners)) l();
}
export const activeSurface = () => active;
export function onActiveSurface(l: () => void): () => void {
	listeners.add(l);
	return () => listeners.delete(l);
}

/** The open thread's surface: action keys run on it when no surface has focus. */
let page: Active | null = null;
export function setPageSurface(next: Active | null): void {
	page = next;
}
export const pageSurface = () => page;
