// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	INCIDENT_ATTENTION_LABEL,
	INCIDENT_ATTENTIONS,
	type IncidentStats,
	SEVERITY_LABEL,
	SeveritySchema,
} from "@prismalens/contracts";
import { LiveSlot } from "@/components/shared/LiveSlot";
import { Mono } from "@/components/shared/Mono";
import { StateChip } from "@/components/shared/StateChip";
import { severityTone } from "@/lib/state-tone";
import { cn } from "@/lib/utils";

export interface QueueStatsProps {
	stats: IncidentStats | undefined;
	isLoading: boolean;
	error: Error | null;
	updatedAt: number;
	onRetry: () => void;
	/** The window the numbers cover, as the operator chose it. */
	window: string;
	openFilter: boolean;
	onToggleOpen: () => void;
	severityFilter?: string;
	onSeverity: (severity: string | undefined) => void;
	className?: string;
}

function formatSeconds(s: number | null): string {
	if (s === null) return "—";
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	return h < 48 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * The queue's numbers: three live slots over the whole window, from
 * incidents.getStats, never from the page of rows underneath. "Needs you" is
 * the same predicate the rows group by, so the count and the group agree.
 */
export function QueueStats({
	stats,
	isLoading,
	error,
	updatedAt,
	onRetry,
	window,
	openFilter,
	onToggleOpen,
	severityFilter,
	onSeverity,
	className,
}: QueueStatsProps) {
	const source = "incidents";
	const needsYou = stats
		? INCIDENT_ATTENTIONS.reduce((n, k) => n + stats.attention[k], 0)
		: 0;

	const slot = (
		label: string,
		value: string,
		note?: string,
	): React.ComponentProps<typeof LiveSlot> =>
		error
			? {
					label,
					state: "failed",
					source,
					reason: error.message,
					onRetry,
				}
			: isLoading || !stats
				? { label, state: "fetching", source }
				: {
						label,
						state: "live",
						value,
						note,
						source,
						window,
						updatedAt: new Date(updatedAt),
					};

	return (
		<div className={cn("space-y-2", className)} data-testid="queue-stats">
			<div className="grid gap-2 sm:grid-cols-3">
				<button
					type="button"
					onClick={onToggleOpen}
					aria-pressed={openFilter}
					className={cn(
						"rounded-md text-left outline-none ring-primary focus-visible:ring-2",
						openFilter && "ring-2",
					)}
					data-testid="queue-stat-open"
				>
					<LiveSlot
						{...slot(
							"Open",
							String(stats?.open ?? 0),
							stats ? `of ${stats.total}` : undefined,
						)}
					/>
				</button>
				<LiveSlot
					{...slot(
						"Needs you",
						String(needsYou),
						stats
							? INCIDENT_ATTENTIONS.filter((k) => stats.attention[k] > 0)
									.map(
										(k) =>
											`${stats.attention[k]} ${INCIDENT_ATTENTION_LABEL[k].toLowerCase()}`,
									)
									.join(" · ") || "nothing waiting"
							: undefined,
					)}
					data-testid="queue-stat-needs-you"
				/>
				<LiveSlot
					{...slot(
						"Time to resolve",
						formatSeconds(stats?.avgTimeToResolve ?? null),
						stats?.avgTimeToResolve === null
							? "no ended incidents"
							: "mean, ended",
					)}
					data-testid="queue-stat-ttr"
				/>
			</div>

			{stats && (
				<div
					className="flex flex-wrap items-center gap-1.5 px-1"
					data-testid="queue-severity"
				>
					<span className="mr-1 text-meta text-muted-foreground">
						By severity
					</span>
					{SeveritySchema.options.map((severity) => {
						const count = stats.bySeverity[severity] ?? 0;
						if (count === 0) return null;
						const active = severityFilter === severity;
						return (
							<button
								key={severity}
								type="button"
								aria-pressed={active}
								onClick={() => onSeverity(active ? undefined : severity)}
								className={cn(
									"rounded outline-none ring-primary focus-visible:ring-2",
									active && "ring-2",
								)}
							>
								<StateChip tone={severityTone(severity)}>
									{SEVERITY_LABEL[severity]}
									<Mono className="ml-0.5">{count}</Mono>
								</StateChip>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
