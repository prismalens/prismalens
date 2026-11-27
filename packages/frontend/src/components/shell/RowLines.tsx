// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A sidebar row's fixed lines (#1020): where it runs and its status corner, the title, a
 * Needs-you cause, then who started it and its branch against its PR, commits, alerts and
 * agent. Badges carry their words as names only; resting on the row opens one card with them.
 */
import { agentName, type ThreadRow } from "@prismalens/contracts";
import {
	type PointerEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
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

/** The service or project a thread runs on, by its icon and name; nothing for neither. */
export function RowPlace({
	t,
}: {
	t: Pick<ThreadRow, "serviceName" | "projectName">;
}) {
	const kind = t.serviceName ? "service" : t.projectName ? "project" : null;
	if (!kind) return null;
	const look = markLook("place", kind);
	const name = t.serviceName ?? t.projectName;
	return (
		<span
			role="img"
			aria-label={`${look.word} ${name}`}
			className="flex min-w-0 items-center gap-1 text-meta text-text-3"
			data-testid="row-place"
			data-place={kind}
			{...fact("project")}
		>
			<look.icon aria-hidden className={ICON} />
			<span className="truncate">{name}</span>
		</span>
	);
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

/** The row's lines in their fixed slots; every row draws all but the cause. */
export function RowLines({
	place,
	corner,
	title,
	cause,
	lead,
	badges,
}: {
	place: ReactNode;
	/** The status icon and the row's one time, top right. */
	corner: ReactNode;
	title: ReactNode;
	cause?: ReactNode;
	/** The meta line's start: the starter, then the reason or where a held row goes, then the branch. */
	lead: ReactNode;
	badges: ReactNode;
}) {
	return (
		<>
			<span
				className="flex min-h-4 min-w-0 items-center justify-between gap-2"
				data-testid="row-context"
			>
				<span className="flex min-w-0 flex-1">{place}</span>
				<span
					className="flex shrink-0 items-center gap-1.5"
					data-testid="row-corner"
				>
					{corner}
				</span>
			</span>
			{title}
			{cause}
			<span
				className="flex min-h-4 min-w-0 items-center justify-between gap-2"
				data-testid="row-meta"
			>
				<span className="flex min-w-0 flex-1 items-center gap-1.5 text-meta text-text-3">
					{lead}
				</span>
				{badges}
			</span>
		</>
	);
}

/** Opens after the pointer rests `ms` on an element and closes as it leaves. */
export function useRest(ms: number) {
	const [at, setAt] = useState<HTMLElement | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const stop = () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
	};
	// A row that unmounts mid-wait never opens its card.
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);
	return {
		at,
		enter: (el: HTMLElement) => {
			stop();
			timer.current = setTimeout(() => setAt(el), ms);
		},
		leave: () => {
			stop();
			setAt(null);
		},
	};
}
