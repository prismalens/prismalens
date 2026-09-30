// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	INCIDENT_ATTENTION_LABEL,
	type IncidentAttention,
} from "@prismalens/contracts";
import { StateWord } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import { attentionFor, attentionTone } from "@/lib/incident-attention";
import { useIncidentRecord } from "../record-context";
import { Card } from "./Card";

const WHY: Record<IncidentAttention, string> = {
	unacknowledged: "Nobody has taken this incident.",
	failed_run: "The last investigation failed and nothing concluded.",
	awaiting_close: "Resolved. Close it with the actual cause recorded.",
};

const CARD_TONE = {
	unacknowledged: "critical",
	failed_run: "failed",
	awaiting_close: "done",
} as const;

/**
 * Rendered only when the attention predicate fires (#743 §3c.3), with the one
 * button that clears it. The same predicate groups the list and the board.
 */
export function NeedsYouCard() {
	const record = useIncidentRecord();
	const why = attentionFor(record.incident);
	// A failed investigation is told once, on the Investigation card.
	if (!why || why === "failed_run") return null;

	const action =
		why === "unacknowledged"
			? { label: "Acknowledge", run: record.acknowledge }
			: { label: "Close", run: record.openClose };

	return (
		<Card
			title="Needs you"
			tone={CARD_TONE[why]}
			aside={
				<StateWord tone={attentionTone[why]}>
					{INCIDENT_ATTENTION_LABEL[why]}
				</StateWord>
			}
			testId="needs-you-card"
		>
			<div className="flex items-center gap-3">
				<p className="min-w-0 flex-1 text-record">{WHY[why]}</p>
				<Button size="sm" onClick={action.run} data-testid="needs-you-action">
					{action.label}
				</Button>
			</div>
		</Card>
	);
}
