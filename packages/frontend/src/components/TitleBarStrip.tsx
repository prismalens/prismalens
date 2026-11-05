// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A drag row for a desktop screen with no title row of its own (pairing, the
 * error pages): clear, so the page shows through. Elsewhere the sidebar's brand
 * row and the page header are the title row (#1020). The browser has none.
 */
export function TitleBarStrip() {
	return (
		<div
			aria-hidden="true"
			className="app-drag fixed inset-x-0 top-0 z-40 hidden h-(--header-h) desktop:block"
			data-testid="drag-row"
		/>
	);
}
