// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The desktop window's draggable top strip (#736). The window controls draw
 * over its right end. The browser has none.
 */
export function TitleBarStrip() {
	return (
		<div
			aria-hidden="true"
			className="app-drag fixed inset-x-0 top-0 z-30 hidden h-(--titlebar-h) bg-canvas desktop:block"
		/>
	);
}
