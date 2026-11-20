// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { FixRef, StartedByVia } from "@prismalens/contracts";
import { parseFixReason } from "./fix-seed.js";
import { SIDE_QUESTION } from "./side-question.js";

/** How a child thread came to be started; the links, the started-by mark and the list share it (#1176 D12). */
export function startedVia(row: {
	role: string | null;
	triggerReason: string | null;
}): StartedByVia {
	if (fixOf(row)) return "fix";
	if (row.role === "fork") return "fork";
	if (row.role === SIDE_QUESTION) return "side";
	return "agent";
}

/** What a fix thread was started for, from its stored trigger reason. */
export function fixOf(row: { triggerReason: string | null }): FixRef | null {
	return parseFixReason(row.triggerReason);
}
