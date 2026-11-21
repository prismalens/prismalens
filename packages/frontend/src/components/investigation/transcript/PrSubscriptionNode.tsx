// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CanonicalEvent,
	PR_SUB_END_WORDS,
	prLabel,
} from "@prismalens/contracts";
import { BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	usePrSubscriptionActions,
	usePrSubscriptions,
} from "@/lib/api/hooks/use-pr-subscriptions";
import type { TranscriptNodeProps } from "./types";

type PrSubscriptionEvent = Extract<CanonicalEvent, { kind: "pr_subscription" }>;

const ICON = "size-3.5 shrink-0 stroke-[1.75]";

/** The sentence for one subscription change, PR named by its host label. */
export function prSubscriptionLine(e: PrSubscriptionEvent): string {
	const n = Number(e.pr.split("#").pop());
	const pr = e.host && Number.isFinite(n) ? prLabel(e.host, n) : e.pr;
	if (e.phase !== "ended")
		return `${e.phase === "started" ? "Subscribed to" : "Subscription changed on"} ${pr}: ${e.summary}`;
	const why = e.reason ? PR_SUB_END_WORDS[e.reason] : "ended";
	const parts = [`Subscription on ${pr} ended: ${why}`];
	if (e.withdrawn)
		parts.push(
			`${e.withdrawn} waiting ${e.withdrawn === 1 ? "event" : "events"} discarded`,
		);
	if (e.alreadySent) parts.push(`${e.alreadySent} already sent`);
	if (e.parked) parts.push(`${e.parked} held after failed sends`);
	return parts.join(", ");
}

/** One line per subscription change (#1179 §7); a started one the list shows live offers Cancel. */
export function PrSubscriptionNode({ event, runId }: TranscriptNodeProps) {
	const e = event as PrSubscriptionEvent;
	const threadId = runId ?? null;
	const list = usePrSubscriptions(e.phase === "started" ? threadId : null);
	const actions = usePrSubscriptionActions(threadId);
	const live = list.data?.subscriptions.some(
		(s) => s.id === e.subscriptionId && s.state !== "ended",
	);
	const Icon = e.phase === "ended" ? BellOff : BellRing;
	return (
		<span
			className="flex min-w-0 items-center gap-2 text-meta text-text-2"
			data-testid="pr-subscription-line"
			data-phase={e.phase}
		>
			<span className="inline-flex shrink-0 text-text-3">
				<Icon aria-hidden className={ICON} />
			</span>
			<span className="min-w-0 truncate">{prSubscriptionLine(e)}</span>
			{e.phase === "started" && live && (
				<Button
					variant="text"
					size="sm"
					disabled={actions.busy}
					onClick={() => void actions.cancel(e.subscriptionId)}
					data-testid="pr-subscription-cancel"
				>
					Cancel
				</Button>
			)}
		</span>
	);
}
