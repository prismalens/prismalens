// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Why a started thread stopped without finishing (#1101 cat 10, amendment 2026-11-13): one
 * closed set that the starter's notice, its wake rule, the human's notice and the live
 * status line all read. A normal finish is not here: the thread reports back itself.
 */
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";
import type { ThreadStatus } from "./thread-status.js";

export const THREAD_STOP_REASONS = [
	"interrupted",
	"crashed",
	"error",
	"provider_failure",
	"user_stop",
	"usage_limit",
] as const;
export const ThreadStopReasonSchema = /* @__PURE__ */ lazySchema(() =>
	z.enum(THREAD_STOP_REASONS),
);
export type ThreadStopReason = z.infer<typeof ThreadStopReasonSchema>;

export interface StopReasonDef {
	/** The words after "stopped:" in the starter's notice and the status line. */
	how: string;
	/** Wakes an idle starter (at most once a minute); otherwise it learns at its next pause. */
	wakes: boolean;
	/** Whether the human hears of it too: once for the account while one usage limit lasts, or never. */
	tellsHuman: "never" | "once_per_limit";
	/** The closed status its mark draws. */
	status: ThreadStatus;
}

export function defineStopReason<const D extends StopReasonDef>(d: D): D {
	return d;
}

export const STOP_REASONS: Readonly<Record<ThreadStopReason, StopReasonDef>> = {
	interrupted: defineStopReason({
		how: "interrupted from outside",
		wakes: true,
		tellsHuman: "never",
		status: "failed",
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
};

/** The text a run whose agent process died ends with (engine `acp-client`). */
const CRASH = /^harness exited early/;

/** The reason an ended run stopped, or null for a normal finish or a run still going. */
export function stopReasonOf(r: {
	status: string;
	endReason: string | null;
	error?: string | null;
}): ThreadStopReason | null {
	if (r.status === "cancelled") return "user_stop";
	if (r.status !== "failed") return null;
	if (r.endReason === "limited") return "usage_limit";
	if (r.endReason === "blocked") return "provider_failure";
	if (r.endReason === "interrupted") return "interrupted";
	return r.error && CRASH.test(r.error) ? "crashed" : "error";
}

/** One stop in a starter's notice. */
export const ThreadStopShape = {
	threadId: z.string(),
	title: z.string().nullable(),
	link: z.string(),
	reason: ThreadStopReasonSchema,
};
