// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The desktop window's title row (#819): empty and draggable, the OS window
 * controls drawn over it. Everything else starts below it; the browser has none.
 */
export function TitleBarStrip() {
	return (
		<div
			aria-hidden="true"
			className="app-drag fixed inset-x-0 top-0 z-40 hidden h-(--titlebar-h) bg-surface-1 desktop:block"
			data-testid="title-row"
		/>
	);
}
