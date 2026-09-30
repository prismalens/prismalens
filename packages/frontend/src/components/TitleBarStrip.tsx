// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The desktop window's draggable top strip (#736). The window controls draw
 * over its right end. In the browser it shows only while the sidebar is folded.
 */
export function TitleBarStrip() {
	return (
		<div
			aria-hidden="true"
			className="app-drag fixed inset-x-0 top-0 z-30 hidden h-(--titlebar-h) bg-background desktop:block md:[[data-sidebar-folded]_&]:block"
		/>
	);
}
