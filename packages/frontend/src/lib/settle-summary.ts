// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What Settle will end, as Surface F's settle preview reports it (#1024). The
 * local shape stands in until that contract lands; only these fields are read.
 */
export interface SettlePreview {
	/** Agents running in the thread, its incident block or its descendants. */
	running: number;
	watches: number;
	crons: number;
	worktrees: { name: string; removed: boolean; reason?: string | null }[];
}

const n = (count: number, one: string, many = `${one}s`) =>
	`${count} ${count === 1 ? one : many}`;

/** The one confirm a running thread asks before it settles; null settles at once. */
export function settleConfirm(
	p: Pick<SettlePreview, "running">,
): string | null {
	return p.running > 0
		? `Stop ${n(p.running, "running agent")} and settle?`
		: null;
}

/** The toast's line: what settling ended, or just "Settled <title>" when nothing will. */
export function settleLine(
	title: string,
	p: SettlePreview,
	stopped = 0,
): string {
	const ends = [
		...(p.watches ? [n(p.watches, "watch", "watches")] : []),
		...(p.crons ? [n(p.crons, "cron")] : []),
	];
	const parts = [
		...(ends.length ? [`Ends ${ends.join(" and ")}`] : []),
		...p.worktrees.map((w) =>
			w.removed
				? `worktree ${w.name} will be removed`
				: `keeps worktree ${w.name}${w.reason ? `: ${w.reason}` : ""}`,
		),
		...(stopped ? [`Stopped ${n(stopped, "agent")}`] : []),
	];
	if (!parts.length) return `Settled ${title}`;
	const [first, ...rest] = parts;
	const head = first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
	return `Settled ${title}. ${[head, ...rest].join(", ")}`;
}

/** A device without the Stop permission settles only threads with nothing to end. */
export function settleBlocked(
	p: SettlePreview,
	canStop: boolean,
): string | null {
	const ends = p.running + p.watches + p.crons + p.worktrees.length;
	return !canStop && ends > 0 ? "Settle on a device that can stop runs" : null;
}
