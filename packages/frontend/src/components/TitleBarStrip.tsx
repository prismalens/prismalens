// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The desktop window's draggable top strip (#736). The window controls draw
 * over its right end; it renders nothing outside the desktop app.
 */
export function TitleBarStrip() {
	return (
		<div
			aria-hidden="true"
			className="app-drag fixed inset-x-0 top-0 z-30 hidden h-(--titlebar-h) bg-background desktop:block"
		/>
	);
}
