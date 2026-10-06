// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	INCIDENT_STATUS_LABEL,
	type IncidentStatus,
	type IncidentWithRelations,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { Mono } from "@/components/shared/Mono";
import { RecordSection } from "@/components/shared/RecordSection";
import { ago, useNow } from "@/hooks/use-now";

/** Incidents (study-v3 §7): this service's, newest first, each one line. */
export function ServiceIncidentsSection({
	incidents,
	total,
}: {
	incidents: IncidentWithRelations[];
	total: number;
}) {
	const now = useNow();
	return (
		<RecordSection id="incidents" title="Incidents" count={total}>
			{incidents.length === 0 ? (
				<p className="text-body text-text-2">None yet.</p>
			) : (
				<ul className="divide-y divide-hairline">
					{incidents.slice(0, 10).map((i) => (
						<li key={i.id} className="flex items-start gap-2.5 py-2.5">
							<span
								aria-hidden
								className="mt-1.5 size-2 shrink-0 rounded-full"
								style={{ background: `var(--sev-${i.severity})` }}
							/>
							<div className="min-w-0 flex-1">
								<Link
									to="/incidents/$id"
									params={{ id: i.id }}
									className="block truncate text-body text-text-1 hover:underline"
								>
									<Mono className="mr-1.5 text-text-3">INC-{i.number}</Mono>
									{i.title}
								</Link>
								<p className="text-meta text-text-3">
									{INCIDENT_STATUS_LABEL[i.status as IncidentStatus]},{" "}
									{ago(i.triggeredAt, now)}
								</p>
							</div>
						</li>
					))}
				</ul>
			)}
		</RecordSection>
	);
}
