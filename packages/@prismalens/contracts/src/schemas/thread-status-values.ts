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

/**
 * Limited needs you only when it can't resume by itself: auto-resume armed with a known
 * reset is a wait, not a call (operator, 2026-11-15, #1101). One rule for list, Home, title and push.
 */
export function limitedResumesItself(f: {
	autoResume: boolean;
	resetKnown: boolean;
}): boolean {
	return f.autoResume && f.resetKnown;
}

/** In rank order: the first that holds is the thread's status. */
export const THREAD_STATUSES = [
	"approval",
	"question",
	"blocked",
	"failed",
	"interrupted",
	"limited",
	"working",
	"waiting",
	"done",
] as const;
