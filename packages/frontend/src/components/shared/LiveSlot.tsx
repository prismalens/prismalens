// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ago, useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import { StateWord } from "./StateWord";

export type LiveSlotState = "live" | "fetching" | "failed" | "not-configured";

interface LiveSlotBase {
	/** What is being measured, e.g. `p99 latency of checkout-api`. */
	label: string;
	className?: string;
}

interface LiveSlotLive extends LiveSlotBase {
	state: "live";
	value: ReactNode;
	/** One or two words after the value: `baseline`, `still climbing`. */
	note?: string;
	source: string;
	window?: string;
	updatedAt: string | Date;
	/** A small trend drawing, sized by the caller. */
	trend?: ReactNode;
}

interface LiveSlotFetching extends LiveSlotBase {
	state: "fetching";
	source?: string;
}

interface LiveSlotFailed extends LiveSlotBase {
	state: "failed";
	/** The dependency that did not answer, named. */
	source: string;
	reason: string;
	onRetry?: () => void;
	lastGood?: { value: ReactNode; at: string | Date };
}

interface LiveSlotNotConfigured extends LiveSlotBase {
	state: "not-configured";
	/** One line saying what is missing. */
	reason: string;
	/** The single action that fixes it. */
	action: { label: string; to: string };
}

export type LiveSlotProps =
	| LiveSlotLive
	| LiveSlotFetching
	| LiveSlotFailed
	| LiveSlotNotConfigured;

/**
 * The one atom for a value that is queried now rather than quoted from the run.
 * Fixed geometry in all four states so arrival order never reflows its neighbours;
 * never a bare number: source, window and age always ride with it.
 */
export function LiveSlot(props: LiveSlotProps) {
	const { label, className } = props;
	const now = useNow();
	return (
		<div
			data-testid="live-slot"
			data-state={props.state}
			className={cn(
				"grid min-h-[5.5rem] grid-rows-[auto_1fr_auto] gap-1 rounded-surface px-3 py-2",
				props.state !== "not-configured" && "raised",
				className,
			)}
		>
			<div className="flex items-center justify-between gap-2">
				<span className="truncate text-meta text-text-3">{label}</span>
				{props.state === "live" && (
					<StateWord tone="live" pulse>
						live
					</StateWord>
				)}
				{props.state === "fetching" && (
					<StateWord tone="neutral">fetching</StateWord>
				)}
				{props.state === "failed" && (
					<StateWord tone="warn">fetch failed</StateWord>
				)}
				{props.state === "not-configured" && (
					<StateWord tone="neutral" quiet>
						not configured
					</StateWord>
				)}
			</div>

			{props.state === "live" && (
				<div className="flex items-end justify-between gap-3">
					<div className="flex items-baseline gap-2">
						<span className="text-display tabular-nums text-text-1">
							{props.value}
						</span>
						{props.note && (
							<span className="font-mono text-meta text-text-2">
								{props.note}
							</span>
						)}
					</div>
					{props.trend && <div className="shrink-0">{props.trend}</div>}
				</div>
			)}
			{props.state === "fetching" && (
				<Skeleton className="h-6 w-24 self-center" />
			)}
			{props.state === "failed" && (
				<p className="self-center text-body text-text-1">{props.reason}</p>
			)}
			{props.state === "not-configured" && (
				<p className="self-center text-body text-text-2">{props.reason}</p>
			)}

			<div className="flex items-center justify-between gap-2 text-meta text-text-2 tabular-nums">
				{props.state === "live" && (
					<span className="flex min-w-0 gap-2.5 truncate">
						<span>{props.source}</span>
						{props.window && <span>{props.window}</span>}
						{now !== null && <span>updated {ago(props.updatedAt, now)}</span>}
					</span>
				)}
				{props.state === "fetching" && (
					<span>{props.source ?? "querying"}</span>
				)}
				{props.state === "failed" && (
					<>
						<span className="truncate">
							{props.lastGood
								? `last good ${props.lastGood.value} at ${new Date(props.lastGood.at).toISOString().slice(11, 16)}Z`
								: props.source}
						</span>
						{props.onRetry && (
							<Button
								type="button"
								variant="secondary"
								size="sm"
								className="h-6 px-2 font-sans text-meta"
								onClick={props.onRetry}
							>
								Retry
							</Button>
						)}
					</>
				)}
				{props.state === "not-configured" && (
					<Button
						asChild
						variant="text"
						size="sm"
						className="h-6 px-0 font-sans text-meta"
					>
						<Link to={props.action.to}>{props.action.label}</Link>
					</Button>
				)}
			</div>
		</div>
	);
}
