// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type ThreadRow,
	type UsageLimits,
	type UsageWindow,
	usageWindowState,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import { markLook } from "@/components/kit/marks";
import { Hint } from "@/components/shared/Hint";
import { Empty } from "@/components/shared/State";
import { useUsageLimits } from "@/lib/api/hooks/use-usage-orpc";
import { formatClock } from "@/lib/format-time";
import { cn } from "@/lib/utils";
import {
	agentGap,
	agentName,
	formatResetAt,
	formatShare,
	formatUntil,
	paceElapsed,
	paceWord,
	percentLeft,
	warnHint,
	warnWindow,
	windowLabel,
} from "./usage-math";

const R = 13;
const C = 2 * Math.PI * R;

/**
 * A window's ring: the used share in its state's tone, a tick where the clock
 * is, and % left inside; near and full swap the number for the mark's icon.
 */
export function UsageRing({
	w,
	now,
	className,
}: {
	w: Pick<UsageWindow, "usedPercent" | "status" | "window" | "resetsAt">;
	now: number;
	className?: string;
}) {
	const state = usageWindowState(w);
	const look = markLook("usage", state);
	const Icon = look.icon;
	const used = w.usedPercent ?? 0;
	const left = percentLeft(w.usedPercent);
	const elapsed = paceElapsed(w.window, w.resetsAt, now);
	const tick = elapsed === null ? null : elapsed * 2 * Math.PI - Math.PI / 2;
	return (
		<span
			className={cn(
				"relative inline-flex size-9 shrink-0 items-center justify-center",
				look.className,
				className,
			)}
			data-testid="usage-ring"
			data-state={state}
		>
			<svg viewBox="0 0 32 32" aria-hidden className="absolute inset-0 size-9">
				<circle
					cx="16"
					cy="16"
					r={R}
					fill="none"
					stroke="currentColor"
					strokeOpacity="0.18"
					strokeWidth="3"
				/>
				{w.usedPercent !== null && used > 0 && (
					<circle
						cx="16"
						cy="16"
						r={R}
						fill="none"
						stroke="currentColor"
						strokeWidth="3"
						strokeLinecap="round"
						strokeDasharray={`${(Math.min(used, 100) / 100) * C} ${C}`}
						transform="rotate(-90 16 16)"
					/>
				)}
				{tick !== null && (
					<line
						data-testid="usage-pace-tick"
						x1={16 + (R - 3) * Math.cos(tick)}
						y1={16 + (R - 3) * Math.sin(tick)}
						x2={16 + (R + 3) * Math.cos(tick)}
						y2={16 + (R + 3) * Math.sin(tick)}
						className="stroke-text-1"
						strokeWidth="1.5"
						strokeLinecap="round"
					/>
				)}
			</svg>
			{state === "near" || state === "full" ? (
				<Icon aria-hidden className="size-3.5" />
			) : (
				<span className="text-[10px] font-medium text-text-1 tabular-nums">
					{left === null ? "?" : Math.round(left)}
				</span>
			)}
		</span>
	);
}

/**
 * The composer footer's warning before a turn (#1101): a small ring, amber at
 * 90% and red when full, by the same rule as the Limited stop. Nothing while
 * every window has room, or for an agent that reports none.
 */
export function ComposerUsageRing({ agent }: { agent: string | undefined }) {
	const limits = useUsageLimits(!!agent).data;
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(t);
	}, []);
	const windows = limits?.agents.find((a) => a.agent === agent)?.windows ?? [];
	const w = warnWindow(windows, now);
	if (!w) return null;
	return <UsageWarnRing w={w} now={now} />;
}

/** The ring itself: used share in the state's tone, the state's icon inside, the reset in its hint. */
export function UsageWarnRing({
	w,
	now,
}: {
	w: Pick<
		UsageWindow,
		"usedPercent" | "status" | "window" | "type" | "resetsAt"
	>;
	now: number;
}) {
	const state = usageWindowState(w);
	const look = markLook("usage", state);
	const Icon = look.icon;
	const hint = warnHint(w, now);
	const used = Math.min(w.usedPercent ?? 100, 100);
	return (
		<Hint label={hint} side="top">
			<span
				role="img"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: the hint is the reset time, so a keyboard must reach it.
				tabIndex={0}
				aria-label={`${look.label}: ${hint}`}
				className={cn(
					"relative inline-flex size-7 shrink-0 items-center justify-center rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent",
					look.className,
				)}
				data-testid="composer-usage-ring"
				data-state={state}
			>
				<svg viewBox="0 0 20 20" aria-hidden className="absolute size-5">
					<circle
						cx="10"
						cy="10"
						r="8"
						fill="none"
						stroke="currentColor"
						strokeOpacity="0.2"
						strokeWidth="2"
					/>
					<circle
						cx="10"
						cy="10"
						r="8"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeDasharray={`${(used / 100) * SMALL_C} ${SMALL_C}`}
						transform="rotate(-90 10 10)"
					/>
				</svg>
				<Icon aria-hidden className="size-2.5 stroke-[2.25]" />
			</span>
		</Hint>
	);
}

const SMALL_C = 2 * Math.PI * 8;

const STATE_WORD = {
	room: null,
	near: "Near the limit",
	full: "Limit reached",
	unknown: "Not reported",
} as const;

/** One window: its ring, its name, % left and the countdown to its reset; the rest is in the hint. */
function WindowTile({ w, now }: { w: UsageWindow; now: number }) {
	const state = usageWindowState(w);
	const left = percentLeft(w.usedPercent);
	const elapsed = paceElapsed(w.window, w.resetsAt, now);
	const pace = paceWord(w.usedPercent, elapsed);
	const name = windowLabel(w);
	const amount =
		state === "full"
			? STATE_WORD.full
			: left === null
				? STATE_WORD.unknown
				: `${Math.round(left)}% left`;
	const meta = [
		STATE_WORD[state],
		w.resetsAt && `Resets ${formatResetAt(w.resetsAt)}`,
		elapsed !== null && `${formatShare(elapsed)} of the window passed`,
		pace,
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<Hint label={`${name}: ${amount}`} meta={meta || undefined}>
			<button
				type="button"
				aria-label={`${name}: ${amount}${meta ? `. ${meta}` : ""}`}
				className="flex min-h-11 w-full min-w-0 cursor-default items-center gap-2.5 rounded-control px-1.5 py-1 text-left outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
				data-testid="usage-window"
				data-state={state}
			>
				<UsageRing w={w} now={now} />
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="flex items-baseline justify-between gap-2">
						<span className="truncate text-body text-text-1">{name}</span>
						<span
							className={cn(
								"shrink-0 text-body tabular-nums",
								state === "full" || state === "near"
									? "font-medium text-text-1"
									: "text-text-2",
							)}
							data-testid="usage-window-left"
						>
							{left !== null && state !== "full" && amount}
						</span>
					</span>
					{w.resetsAt && (
						<span
							className="inline-flex items-center gap-1 text-meta text-text-3 tabular-nums"
							data-testid="usage-reset"
						>
							<RotateCw aria-hidden className="size-3" />
							{formatUntil(w.resetsAt, now)}
						</span>
					)}
				</span>
			</button>
		</Hint>
	);
}

/** An agent's missing usage data as one short line under a muted mark (sheet §7). */
export function AgentGap({
	agent,
	silent,
	text,
}: {
	agent: string;
	silent?: boolean;
	/** The page's own words for what is missing, in place of the agent's general gap. */
	text?: string;
}) {
	const gap = text ?? (silent ? "Nothing reported" : agentGap(agent));
	if (!gap) return null;
	const look = markLook("usage", "unreported");
	const Icon = look.icon;
	return (
		<span
			className="inline-flex min-w-0 items-center gap-1.5 text-meta text-text-3"
			data-testid="usage-gap"
			data-agent={agent}
		>
			<Icon aria-hidden className={cn("size-3.5 shrink-0", look.className)} />
			<span className="truncate">{gap}</span>
		</span>
	);
}

/** A thread held by its agent's limit: Limited with when it goes on, or Blocked with no timer. */
export type WaitingThread = Pick<
	ThreadRow,
	"id" | "title" | "harness" | "limit"
>;

/** The threads one agent's limit holds now, each a link with when it goes on (#1101 cat 17). */
function WaitingThreads({
	threads,
	now,
}: {
	threads: readonly WaitingThread[];
	now: number;
}) {
	return (
		<ul
			className="m-0 grid max-w-xl list-none gap-0.5 p-0"
			data-testid="usage-waiting"
		>
			{threads.map((t) => {
				const at = t.limit?.resetsAt ?? t.limit?.nextAttemptAt ?? null;
				const look = markLook("usage", at ? "full" : "unreported");
				const Icon = look.icon;
				return (
					<li key={t.id}>
						<Link
							to="/threads/$id"
							params={{ id: t.id }}
							className="flex min-h-9 min-w-0 items-center gap-2 rounded-control px-1.5 text-body outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
							data-testid="usage-waiting-thread"
						>
							<Icon
								aria-hidden
								className={cn("size-3.5 shrink-0", look.className)}
							/>
							<span className="min-w-0 flex-1 truncate text-text-1">
								{t.title ?? "Thread"}
							</span>
							<Hint
								label={
									at
										? `Goes on at ${formatResetAt(at)}`
										: "Waits for you: no timer"
								}
							>
								<span className="shrink-0 text-meta text-text-2 tabular-nums">
									{at
										? `${formatClock(at)} · in ${formatUntil(at, now)}`
										: "Blocked"}
								</span>
							</Hint>
						</Link>
					</li>
				);
			})}
		</ul>
	);
}

/** Each agent's usage windows as it last reported them; `now` is passed so fixtures hold still. */
export function UsageLimitsPanel({
	limits,
	now,
	waiting = [],
}: {
	limits: UsageLimits;
	now: number;
	/** Threads that wait on a limit now, from the thread list's feed. */
	waiting?: readonly WaitingThread[];
}) {
	if (limits.agents.length === 0) return <Empty text="No agent has run yet." />;
	return (
		<div className="grid min-w-0 gap-4" data-testid="usage-limits">
			{limits.agents.map((a) => {
				const name = agentName(a.agent);
				const held = waiting.filter((t) => t.harness === a.agent);
				const latest = a.windows.reduce<string | null>(
					(max, w) => (max === null || w.at > max ? w.at : max),
					null,
				);
				return (
					<section
						key={a.agent}
						className="grid min-w-0 gap-1"
						aria-label={name}
						data-testid="usage-agent"
					>
						<div className="flex min-w-0 items-center gap-2">
							<AgentMark id={a.agent} className="size-4" />
							<h3 className="text-body font-medium text-text-1">{name}</h3>
							{latest && (
								<Hint label={`Reported ${formatClock(latest)}`}>
									<span className="text-meta text-text-3 tabular-nums">
										{formatClock(latest)}
									</span>
								</Hint>
							)}
							{a.windows.length === 0 && (
								<AgentGap agent={a.agent} text="No windows reported" />
							)}
						</div>
						{a.windows.length > 0 && (
							<div className="grid grid-cols-[repeat(auto-fill,minmax(220px,280px))] gap-x-3 max-sm:grid-cols-1 gap-y-1">
								{a.windows.map((w) => (
									<WindowTile
										key={`${w.type ?? ""}:${w.window ?? ""}`}
										w={w}
										now={now}
									/>
								))}
							</div>
						)}
						{held.length > 0 && <WaitingThreads threads={held} now={now} />}
					</section>
				);
			})}
		</div>
	);
}
