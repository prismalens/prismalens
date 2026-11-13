// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInvestigationEventsHistory } from "@/lib/api/hooks/use-investigation-events";
import { useInvestigation } from "@/lib/api/hooks/use-investigations-orpc";
import { useCompactSession } from "@/lib/api/hooks/use-session-orpc";
import { contextBreakdown } from "@/lib/context-breakdown";
import { useContextMeterSignal } from "@/lib/context-meter";
import { lazyPart } from "@/lib/lazy";

// The context meter loads when drawn (#1101 category 12).
const ContextMeter = lazyPart(() =>
	import("@/components/thread/session/ContextMeter").then(
		(m) => m.ContextMeter,
	),
);

import type { LaneSlots, SlotContext } from "./types";

/** The context meter in the composer footer, on every thread (#1101 cat 11). */
export function useContextSlots(ctx: SlotContext): LaneSlots {
	return ctx.page === "thread" && ctx.threadId
		? {
				composerFooter: (
					<ThreadContextMeter threadId={ctx.threadId} live={ctx.live} />
				),
			}
		: {};
}

function ThreadContextMeter({
	threadId,
	live,
}: {
	threadId: string;
	live: boolean;
}) {
	const inv = useInvestigation(threadId).data;
	const events = useInvestigationEventsHistory(threadId).data;
	const compact = useCompactSession(threadId);
	const [open, setOpen] = useState(false);
	const signal = useContextMeterSignal();
	const seen = useRef(signal);
	useEffect(() => {
		if (signal !== seen.current) {
			seen.current = signal;
			setOpen(true);
		}
	}, [signal]);
	const usage = inv?.usage ?? null;
	const facts = inv?.harness
		? HARNESS_REGISTRY[inv.harness as HarnessId]
		: undefined;
	const breakdown = useMemo(
		() => (open && usage && events ? contextBreakdown(events, usage) : null),
		[open, usage, events],
	);
	return (
		<div className="flex justify-end" data-testid="context-slot">
			<ContextMeter
				usage={usage}
				session={inv?.session}
				agent={facts?.label}
				autoAt={facts?.autoCompactPercent}
				breakdown={breakdown}
				compactTakesFocus={facts?.compactTakesFocus}
				open={open}
				onOpenChange={setOpen}
				onCompact={(focus) =>
					compact.mutate(focus, { onSuccess: () => setOpen(false) })
				}
				compacting={compact.isPending}
				running={live}
			/>
		</div>
	);
}
