// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import { useNow } from "@/hooks/use-now";
import { attentionFor } from "@/lib/incident-attention";
import { incidentLineage } from "@/lib/incident-board";
import { incidentSummary } from "@/lib/incident-summary";
import { incidentServices } from "@/lib/service-lanes";
import { useIncidentRecord } from "../record-context";

/** Whether an investigation ran with no repository, from the entry it wrote at start. */
export function useRanWithoutRepo(investigationId: string | null): boolean {
	const { timeline } = useIncidentRecord();
	if (!investigationId) return false;
	return timeline.some(
		(e) =>
			e.metadata?.investigationId === investigationId &&
			e.metadata?.mapped === false,
	);
}

/**
 * The incident in a few sentences and the one next step (#743), above the
 * cards, for whoever opens it cold.
 */
export function SummaryBlock() {
	const record = useIncidentRecord();
	const { incident, runs } = record;
	const now = useNow();
	const noRepo = useRanWithoutRepo(runs[0]?.id ?? null);
	const { lines, next } = incidentSummary({
		now: now ?? Date.now(),
		alerts: incident.alerts ?? [],
		services: incidentServices(incident).map((s) => s.name),
		runs,
		noRepo,
		attention: attentionFor(incident),
	});
	const serviceId = incident.service?.id;
	const lineage = incidentLineage(incident);
	return (
		<section
			className="space-y-1.5 px-1 pb-1"
			aria-label="Summary"
			data-testid="incident-summary"
		>
			{lineage && (
				<p className="text-body" data-testid="incident-lineage">
					<span className="font-medium">{lineage.lead}</span> {lineage.text}
				</p>
			)}
			<p className="text-body leading-relaxed">{lines.join(" ")}</p>
			{next && (
				<p className="text-body" data-testid="incident-next">
					<span className="text-text-2">Next: </span>
					{next.kind === "link-repo" && serviceId ? (
						<Link
							to="/services/$id"
							search={{ tab: "repositories" }}
							params={{ id: serviceId }}
							className="text-accent hover:underline"
						>
							{next.text}
						</Link>
					) : next.kind === "acknowledge" ? (
						<button
							type="button"
							onClick={record.acknowledge}
							className="text-accent hover:underline"
						>
							{next.text}
						</button>
					) : next.kind === "close" ? (
						<button
							type="button"
							onClick={record.openClose}
							className="text-accent hover:underline"
						>
							{next.text}
						</button>
					) : (
						next.text
					)}
				</p>
			)}
		</section>
	);
}
