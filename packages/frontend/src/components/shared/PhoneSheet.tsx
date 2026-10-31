// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactElement } from "react";
import { createPortal } from "react-dom";

/**
 * A pane that sits beside the page, and covers the screen on a phone. The page frames
 * are position:fixed stacking contexts a z-index cannot leave, so the sheet portals to
 * the body to clear the z-40 topbar and the strips (#874, 0.5.3 walk W11).
 */
export function PhoneSheet({
	phone,
	children,
}: {
	phone: boolean;
	children: ReactElement;
}) {
	if (!phone) return children;
	return createPortal(
		<div
			className="fixed inset-0 z-50 flex flex-col bg-surface-1"
			data-testid="phone-sheet"
		>
			{children}
		</div>,
		document.body,
	);
}
