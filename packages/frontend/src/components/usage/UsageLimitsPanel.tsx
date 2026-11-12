// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { UsageLimits, UsageWindow } from "@prismalens/contracts";
import { Hint } from "@/components/shared/Hint";
import { Pool } from "@/components/shared/Row";
import { Empty } from "@/components/shared/State";
import { formatClock, formatDateTime } from "@/lib/format-time";
import { cn } from "@/lib/utils";
import {
	agentName,
	formatShare,
	formatUntil,
	paceElapsed,
	paceWord,
	percentLeft,
	windowLabel,
} from "./usage-math";

/** One window: "N% left" as a used bar against the track, a tick where the clock is, and the reset. */
function WindowRow({ w, now }: { w: UsageWindow; now: number }) {
	const left = percentLeft(w.usedPercent);
	const elapsed = paceElapsed(w.window, w.resetsAt, now);
	const pace = paceWord(w.usedPercent, elapsed);
	const out = left === 0 || w.status === "rejected";
	const fill =
		left === null
			? ""
			: left < 10
				? "bg-danger"
				: left < 25
					? "bg-warn"
					: "bg-accent";
	return (
		<div
			className="grid gap-1.5 py-3 relative after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-hairline first:after:hidden"
			data-testid="usage-window"
		>
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<span className="text-heading text-text-1">{windowLabel(w)}</span>
				<span
					className="text-body font-medium text-text-1 tabular-nums"
					data-testid="usage-window-left"
				>
					{out
						? "Limit reached"
						: left === null
							? "Unknown"
							: `${Math.round(left)}% left`}
				</span>
			</div>
			<div aria-hidden className="relative h-2 rounded-full bg-track">
				{w.usedPercent !== null && (
					<span
						className={cn("absolute inset-y-0 left-0 rounded-full", fill)}
						style={{ width: `${w.usedPercent}%` }}
					/>
				)}
				{elapsed !== null && (
					<span
						aria-hidden
						data-testid="usage-pace-tick"
						className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-text-1"
						style={{ left: `${elapsed * 100}%` }}
					/>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-text-2">
				{w.resetsAt && (
					<Hint label={`Resets ${formatDateTime(w.resetsAt)}`}>
						<button
							type="button"
							className="inline-flex min-h-6 items-center rounded-control bg-surface-3 px-1.5 text-text-1 tabular-nums max-sm:min-h-11"
							data-testid="usage-reset"
						>
							resets in {formatUntil(w.resetsAt, now)}
						</button>
					</Hint>
				)}
				{elapsed !== null && (
					<span>{formatShare(elapsed)} of the window has passed</span>
				)}
				{pace && <span className="font-medium text-text-1">{pace}</span>}
			</div>
		</div>
	);
}

/** Each agent's usage windows as it last reported them; `now` is passed so fixtures hold still. */
export function UsageLimitsPanel({
	limits,
	now,
}: {
	limits: UsageLimits;
	now: number;
}) {
	if (limits.agents.length === 0) return <Empty text="No agent has run yet." />;
	return (
		<div className="grid min-w-0 gap-6" data-testid="usage-limits">
			{limits.agents.map((a) => {
				const name = agentName(a.agent);
				const latest = a.windows.reduce<string | null>(
					(max, w) => (max === null || w.at > max ? w.at : max),
					null,
				);
				return (
					<section
						key={a.agent}
						className="grid gap-1"
						data-testid="usage-agent"
					>
						<div className="flex flex-wrap items-baseline justify-between gap-x-3">
							<h3 className="text-body font-medium text-text-2">{name}</h3>
							{latest && (
								<span className="text-meta text-text-3">
									as of {formatClock(latest)}
								</span>
							)}
						</div>
						{a.windows.length === 0 ? (
							<p className="py-2 text-body text-text-3">
								{name} reports no usage windows to PrismaLens.
							</p>
						) : (
							<Pool>
								{a.windows.map((w) => (
									<WindowRow
										key={`${w.type ?? ""}:${w.window ?? ""}`}
										w={w}
										now={now}
									/>
								))}
							</Pool>
						)}
					</section>
				);
			})}
		</div>
	);
}
