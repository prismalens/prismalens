// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";

/** A scrolling stack of sections: the kind and Details panes. */
export function PanelStack({ children }: { children: ReactNode }) {
	return (
		<div
			className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pt-3 pb-5"
			data-testid="panel-stack"
		>
			{children}
		</div>
	);
}
