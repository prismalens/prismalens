// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { cn } from "@/lib/utils";
import type { Tone } from "./tick-copy";

const TONE: Record<Tone, string> = {
	ok: "bg-ok",
	bad: "bg-danger",
	warn: "bg-warn",
	live: "bg-live motion-safe:animate-pulse",
	muted: "bg-text-3",
};

/** The colour repeats what the words say; it is never the only signal (#939). */
export function TickDot({ tone }: { tone: Tone }) {
	return (
		<span
			aria-hidden
			className={cn("inline-block size-2 shrink-0 rounded-full", TONE[tone])}
		/>
	);
}
