// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { AlertsCard } from "./AlertsCard";
import { ConclusionCard } from "./ConclusionCard";
import { DetailsCard } from "./DetailsCard";
import { NeedsYouCard } from "./NeedsYouCard";
import { RunCard } from "./RunCard";
import { TimelineCard } from "./TimelineCard";

/**
 * The incident page's cards in the SRE's order (#743 §3c): is something being
 * done, what do we know, what needs me, then alerts, timeline and details.
 * The conversation route's Summary panel is the same stack.
 */
export function CardStack({ inPanel = false }: { inPanel?: boolean }) {
	return (
		<>
			<RunCard inPanel={inPanel} />
			<ConclusionCard />
			<NeedsYouCard />
			<AlertsCard />
			<TimelineCard />
			<DetailsCard />
		</>
	);
}
