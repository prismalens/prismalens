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
	"disk_full",
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

/** One stop in a starter's notice. */
export const ThreadStopShape = {
	threadId: z.string(),
	title: z.string().nullable(),
	link: z.string(),
	reason: ThreadStopReasonSchema,
};
