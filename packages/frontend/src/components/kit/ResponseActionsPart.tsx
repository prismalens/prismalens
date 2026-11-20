// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { lazyPart } from "@/lib/lazy";

/**
 * The quiet row after an agent response (sheet §2, §9.2). Its icons are the registry's
 * message actions, so the first frame holds the row's height and they draw after the
 * page's first content (#1101 category 12).
 */
export const ResponseActions = lazyPart(
	() => import("./ResponseActions").then((m) => m.ResponseActions),
	<div className="h-6" data-testid="response-actions-held" />,
	{ afterFirstContent: true },
);
