// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadStatus } from "@prismalens/contracts";
import { useThreadListModel } from "@/components/shell/ThreadList";
import { StatusMark } from "@/components/shell/ThreadTree";
import { lazyPart } from "@/lib/lazy";
import { cn } from "@/lib/utils";

export type BadgeProps = {
	className?: string;
	countClassName?: string;
	testId: string;
	side?: "bottom" | "right";
};
export type BadgeFaceProps = { count: number; top: ThreadStatus };

export const BADGE_CLASS =
	"flex items-center gap-1.5 rounded-control font-medium text-text-1 tabular-nums hover:bg-surface-2";
export const badgeLabel = (count: number) => `${count} waiting for you`;

export function BadgeFace({
	count,
	top,
	countClassName,
}: BadgeFaceProps & { countClassName?: string }) {
	return (
		<>
			<StatusMark status={top} />
			<span className={countClassName}>{count}</span>
		</>
	);
}

/**
 * Needs you where the sidebar's list is off screen: the count, drawn with the most urgent
 * waiting status. Home carries no queue of its own.
 */
export function NeedsBadge(props: BadgeProps) {
	const { model } = useThreadListModel();
	const count = model.needsCount;
	const top = model.needs[0]?.info.status;
	if (!count || !top) return null;
	return <NeedsBadgePart {...props} count={count} top={top} />;
}

let clickedEarly: string | null = null;
/** True once for the badge a click reached before its code had loaded: it opens on arrival. */
export const takeEarlyClick = (testId: string) => {
	if (clickedEarly !== testId) return false;
	clickedEarly = null;
	return true;
};

/** The popover, its list and the fixes' registry load after the first paint (entry-budget.json). */
export const NeedsBadgePart = lazyPart(
	() => import("./NeedsBadgePopover").then((m) => m.NeedsBadgePopover),
	(p: BadgeProps & BadgeFaceProps) => (
		<button
			type="button"
			aria-label={badgeLabel(p.count)}
			onPointerEnter={() => void NeedsBadgePart.preload(true)}
			onFocus={() => void NeedsBadgePart.preload(true)}
			onClick={() => {
				clickedEarly = p.testId;
				void NeedsBadgePart.preload(true);
			}}
			className={cn(BADGE_CLASS, p.className)}
			data-testid={p.testId}
			data-urgent={p.top}
		>
			<BadgeFace
				count={p.count}
				top={p.top}
				countClassName={p.countClassName}
			/>
		</button>
	),
	{ afterFirstContent: true },
);
