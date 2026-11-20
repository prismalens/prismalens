// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).
import type { StopReasonDef, ThreadStopReason } from "./thread-stops.js";

export function defineStopReason<const D extends StopReasonDef>(d: D): D {
	return d;
}

export const STOP_REASONS: Readonly<Record<ThreadStopReason, StopReasonDef>> = {
	interrupted: defineStopReason({
		how: "interrupted from outside",
		wakes: true,
		tellsHuman: "never",
		status: "interrupted",
	}),
	crashed: defineStopReason({
		how: "its agent process ended",
		wakes: true,
		tellsHuman: "never",
		status: "failed",
	}),
	error: defineStopReason({
		how: "failed with an error",
		wakes: true,
		tellsHuman: "never",
		status: "failed",
	}),
	provider_failure: defineStopReason({
		how: "its provider refused it",
		wakes: true,
		tellsHuman: "never",
		status: "blocked",
	}),
	// A wake would not help: the user meant it, and must not see it restarted.
	user_stop: defineStopReason({
		how: "stopped by the user",
		wakes: false,
		tellsHuman: "never",
		status: "done",
	}),
	// A wake would hit the same limit.
	usage_limit: defineStopReason({
		how: "hit a usage limit and resumes at its reset",
		wakes: false,
		tellsHuman: "once_per_limit",
		status: "limited",
	}),
	// A wake would fail the same way until someone frees space.
	disk_full: defineStopReason({
		how: "had no disk space for its worktree",
		wakes: false,
		tellsHuman: "never",
		status: "blocked",
	}),
};
