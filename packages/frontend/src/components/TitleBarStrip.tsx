// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The desktop window's draggable top strip (#736) for screens with no page
 * header: pairing, not found and errors. Elsewhere the header is the strip
 * (#811). The window controls draw over its right end; the browser has none.
 */
export function TitleBarStrip() {
	return (
		<div
			aria-hidden="true"
			className="app-drag fixed inset-x-0 top-0 z-30 hidden h-(--titlebar-h) bg-canvas desktop:block"
		/>
	);
}
