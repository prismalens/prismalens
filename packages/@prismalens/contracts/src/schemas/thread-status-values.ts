// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).
import type { ThreadStatus } from "./thread-status.js";

/** The states that put a thread on top of the list. */
export const NEEDS_YOU_STATUSES = [
	"approval",
	"question",
	"blocked",
	"failed",
	"interrupted",
	"limited",
] as const satisfies readonly ThreadStatus[];

export function isNeedsYou(s: ThreadStatus | null | undefined): boolean {
	return (NEEDS_YOU_STATUSES as readonly string[]).includes(s ?? "");
}
