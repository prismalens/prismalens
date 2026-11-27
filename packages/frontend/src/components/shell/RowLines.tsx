// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A sidebar row's fixed lines (#1020): where it runs and its status corner, the title, a
 * Needs-you cause, then who started it and its branch. The badges at the meta line's end
 * load after first content (`RowBadges`); resting on the row opens one card with them all.
 */
import type { ThreadRow } from "@prismalens/contracts";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { fact } from "@/components/kit/fact";
import { middleCut } from "@/components/kit/MarkBadges";
import { markLook } from "@/components/kit/marks";
import { cn } from "@/lib/utils";

const ICON = "size-3 shrink-0";

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

/** The branch, cut in the middle; its icon turns danger while the worktree is in a conflict. */
export function RowBranch({ t }: { t: Pick<ThreadRow, "branch" | "git"> }) {
	if (!t.branch) return null;
	const conflict = t.git?.state === "conflict";
	const look = conflict
		? markLook("gitState", "conflict")
		: markLook("branch", "any");
	return (
		<span
			role="img"
			aria-label={`Branch ${t.branch}${conflict ? ", in a conflict" : ""}`}
			className="flex min-w-0 items-center gap-1"
			data-testid="row-branch"
			{...fact("branch")}
		>
			<look.icon aria-hidden className={cn(ICON, look.className)} />
			<span className="truncate font-mono">{middleCut(t.branch, 20)}</span>
		</span>
	);
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
			{/* Some agents' logos have a 20 px floor (their brand rules): every meta line keeps that height. */}
			<span
				className="flex h-5 min-w-0 items-center justify-between gap-2"
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
	const unlisten = useRef<(() => void) | null>(null);
	const stop = () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		unlisten.current?.();
		unlisten.current = null;
	};
	const leave = () => {
		stop();
		setAt(null);
	};
	// A row that unmounts mid-wait never opens its card.
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
			unlisten.current?.();
		},
		[],
	);
	return {
		at,
		enter: (el: HTMLElement) => {
			stop();
			timer.current = setTimeout(() => setAt(el), ms);
			// A scroll of the list under the pointer is not a rest: it cancels or closes the card.
			const onScroll = (e: Event) => {
				if (e.target instanceof Node && e.target.contains(el)) leave();
			};
			document.addEventListener("scroll", onScroll, {
				capture: true,
				passive: true,
			});
			unlisten.current = () =>
				document.removeEventListener("scroll", onScroll, { capture: true });
		},
		leave,
	};
}
