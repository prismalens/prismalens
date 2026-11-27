// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The meta line's badges (#1020): PR, commits, alerts and the session's agent, named in words
 * only. They load after the list's first content into the line's reserved end (entry-budget.json).
 */
import { agentName, type ThreadRow } from "@prismalens/contracts";
import type { PointerEvent, ReactNode } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import { fact } from "@/components/kit/fact";
import { markLook } from "@/components/kit/marks";
import { cn } from "@/lib/utils";

const ICON = "size-3 shrink-0";

const plural = (n: number, one: string, many = `${one}s`) =>
	`${n} ${n === 1 ? one : many}`;

/** The PR badge's name: the count first once there are several (#1020). */
export function prLabel(pr: NonNullable<ThreadRow["pr"]>): string {
	const word = markLook("changeRequest", pr.tone).word ?? pr.tone;
	const count = pr.count ?? 1;
	return count > 1
		? `${count} PRs, newest #${pr.number}, ${word}`
		: `Pull request #${pr.number}, ${word}`;
}

function Badge({
	kind,
	label,
	children,
	className,
	...on
}: {
	kind: string;
	label: string;
	children: ReactNode;
	className?: string;
	onPointerEnter?: (e: PointerEvent<HTMLSpanElement>) => void;
	onPointerLeave?: () => void;
}) {
	return (
		<span
			role="img"
			aria-label={label}
			className={cn("flex items-center gap-1", className)}
			data-testid={`row-badge-${kind}`}
			{...on}
		>
			{children}
		</span>
	);
}

/** The meta line's end: PR, commits, alerts, then the session's agent, always last. */
export function RowBadges({
	t,
	alerts,
	onPrEnter,
	onPrLeave,
}: {
	t: Pick<ThreadRow, "pr" | "commits" | "harness" | "model">;
	/** The thread's incident's alerts; absent off an incident. */
	alerts?: number | undefined;
	onPrEnter?: (el: HTMLElement) => void;
	onPrLeave?: () => void;
}) {
	const pr = t.pr;
	const look = pr ? markLook("changeRequest", pr.tone) : null;
	const more = (pr?.count ?? 1) - 1;
	return (
		<span className="flex shrink-0 items-center gap-2.5 text-meta text-text-3 tabular-nums">
			{pr && look && (
				<Badge
					kind="pr"
					label={prLabel(pr)}
					{...fact("pr")}
					onPointerEnter={(e) => onPrEnter?.(e.currentTarget)}
					onPointerLeave={onPrLeave}
				>
					<look.icon aria-hidden className={cn(ICON, look.className)} />
					<span>#{pr.number}</span>
					{more > 0 && <span>+{more}</span>}
				</Badge>
			)}
			{!!t.commits && (
				<Badge kind="commits" label={plural(t.commits, "commit")}>
					<CommitsIcon />
					{t.commits}
				</Badge>
			)}
			{!!alerts && (
				<Badge kind="alerts" label={plural(alerts, "alert")}>
					<AlertsIcon />
					{alerts}
				</Badge>
			)}
			{t.harness && (
				<Badge
					kind="agent"
					label={`${agentName(t.harness)}${t.model ? ` · ${t.model}` : ""}`}
				>
					<AgentMark id={t.harness} className="size-3.5" />
				</Badge>
			)}
		</span>
	);
}

function CommitsIcon() {
	const look = markLook("commits", "any");
	return <look.icon aria-hidden className={ICON} />;
}

function AlertsIcon() {
	const look = markLook("alerts", "any");
	return <look.icon aria-hidden className={ICON} />;
}
