// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { Mono } from "@/components/shared/Mono";
import { incidentServices } from "@/lib/service-lanes";
import { ago, workingOf } from "./inbox-model";

/** Working under Needs you: incidents a run is on with no finding yet, quiet. */
export function Working({
	incidents,
	now,
}: {
	incidents: IncidentWithRelations[];
	now: number;
}) {
	const rows = workingOf(incidents);
	if (rows.length === 0) return null;
	return (
		<section
			aria-labelledby="working-heading"
			className="flex shrink-0 flex-col gap-1"
			data-testid="inbox-working"
		>
			<h2 id="working-heading" className="px-0.5 text-heading text-text-2">
				Working
			</h2>
			{rows.map(({ incident: i, run }) => {
				const service = incidentServices(i)[0]?.name;
				return (
					<Link
						key={i.id}
						to="/investigations/$id"
						params={{ id: run.id }}
						className="flex h-9 min-w-0 items-center gap-4 rounded-surface px-4 whitespace-nowrap text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3"
						data-testid="working-row"
						data-incident={i.id}
					>
						<Mono className="w-[52px] shrink-0 text-text-3">
							INC-{i.number}
						</Mono>
						<span dir="auto" className="min-w-0 flex-1 truncate text-text-1">
							{i.title}
						</span>
						{service && (
							<span
								dir="auto"
								className="max-w-[180px] min-w-0 shrink truncate text-meta text-text-3 max-md:hidden"
							>
								{service}
							</span>
						)}
						<span className="shrink-0">
							{run.endReason === "interrupted"
								? "Resumed after a restart"
								: "No finding yet"}
						</span>
						<span className="w-[52px] shrink-0 text-right text-meta text-text-3 tabular-nums">
							{ago(run.startedAt ?? run.createdAt, now)}
						</span>
					</Link>
				);
			})}
		</section>
	);
}
