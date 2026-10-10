// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { Mono } from "@/components/shared/Mono";
import { ago } from "./inbox-model";

/** Recently resolved under Needs you: ID, title, how it ended, when. */
export function RecentlyResolved({
	rows,
	now,
}: {
	rows: IncidentWithRelations[];
	now: number;
}) {
	if (rows.length === 0) return null;
	return (
		<section
			aria-labelledby="recent-heading"
			className="flex shrink-0 flex-col gap-1"
			data-testid="recently-resolved"
		>
			<div className="flex items-baseline gap-3 px-0.5">
				<h2 id="recent-heading" className="text-heading text-text-2">
					Recently resolved
				</h2>
				<Link
					to="/incidents"
					search={{ view: "all", status: "closed" }}
					className="text-meta text-accent hover:underline hover:underline-offset-3"
				>
					All incidents
				</Link>
			</div>
			{rows.map((i) => (
				<Link
					key={i.id}
					to="/incidents/$id"
					params={{ id: i.id }}
					className="flex h-9 min-w-0 items-center gap-4 rounded-surface px-4 whitespace-nowrap text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3"
					data-testid="recent-row"
				>
					<Mono className="w-[52px] shrink-0 text-text-3">INC-{i.number}</Mono>
					<span dir="auto" className="min-w-0 flex-1 truncate text-text-1">
						{i.title}
					</span>
					<span className="shrink-0">
						{i.mergedInto
							? `Merged into INC-${i.mergedInto.number}`
							: "Resolved by you"}
					</span>
					<span className="w-[52px] shrink-0 text-right text-meta text-text-3 tabular-nums">
						{ago(i.closedAt ?? i.updatedAt, now)} ago
					</span>
				</Link>
			))}
		</section>
	);
}

/** The Needs-you slot when no agent is set up (spec §1, empty state). */
export function SetupCard({ done }: { done: number }) {
	return (
		<div
			className="flex flex-wrap items-center gap-4 rounded-pool bg-accent/8 px-[18px] py-4 dark:bg-accent/12"
			data-testid="inbox-setup"
		>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="font-semibold">
					Set up a coding agent to investigate incidents
				</span>
				<span className="text-text-2">
					Setup is {done} of 4 done. Alerts still arrive and open incidents;
					nothing investigates them until an agent is set up.
				</span>
			</div>
			<Link
				to="/settings"
				search={{ tab: "harness" }}
				className="inline-flex h-8 shrink-0 items-center rounded-control bg-accent-solid px-3.5 font-medium text-accent-fg transition-colors duration-(--dur-instant) hover:bg-[oklch(from_var(--accent-solid)_calc(l_+_0.05)_c_h)]"
				data-testid="inbox-setup-agent"
			>
				Set up an agent
			</Link>
		</div>
	);
}
