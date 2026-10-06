// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo } from "react";
import { inIncident, useBack } from "@/hooks/use-back";
import { useSlidingMark } from "@/hooks/use-sliding-mark";
import { cn } from "@/lib/utils";
import { RECORD_ROUTES, type RecordRoute } from "./RecordLayout";

const NAMES: Record<RecordRoute, string> = {
	conversation: "Conversation",
	report: "Report",
	alerts: "Alerts",
	timeline: "Timeline",
};

function isTyping(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	const tag = el?.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		!!el?.isContentEditable
	);
}

/**
 * The incident's tabs (#743): Overview is the card page, the others are the
 * routes a card's link opens. With the band they form the record's s1 header
 * region; the active tab's underline is one mark that slides (look ruling §2).
 * Every tab exists whatever the run did. The run's state rides at the right
 * end of the row. Esc is the band's chevron (R4.4): back to where you came
 * from, unless the box, a field or a popover has it.
 */
export function RecordTabs({
	incidentId,
	here,
	counts,
	status,
}: {
	incidentId: string;
	here: RecordRoute | null;
	counts: Partial<Record<RecordRoute, number>>;
	status?: ReactNode;
}) {
	const leaf = useMemo(() => inIncident(incidentId), [incidentId]);
	const back = useBack(leaf, "/incidents");
	const { ref, box } = useSlidingMark<HTMLElement>('[data-state="active"]');

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented || isTyping(e.target))
				return;
			if (
				document.querySelector(
					"[data-radix-popper-content-wrapper], [role=dialog]",
				)
			)
				return;
			back();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [back]);

	const tab = (active: boolean) =>
		cn(
			"inline-flex h-9 shrink-0 items-center gap-1.5 text-body transition-colors duration-(--dur-fast)",
			active ? "font-medium text-text-1" : "text-text-2 hover:text-text-1",
		);

	return (
		<div
			className="flex shrink-0 items-center gap-x-3 bg-surface-1 px-4"
			data-testid="record-tabs"
		>
			<nav
				ref={ref}
				aria-label="Incident"
				className="relative flex min-w-0 items-center gap-4 overflow-x-auto [scrollbar-width:none] md:gap-[18px]"
			>
				<Link
					to="/incidents/$id"
					params={{ id: incidentId }}
					search={true}
					viewTransition
					aria-current={here === null ? "page" : undefined}
					data-state={here === null ? "active" : "inactive"}
					className={tab(here === null)}
					data-testid="tab-overview"
				>
					Overview
				</Link>
				{(Object.keys(NAMES) as RecordRoute[]).map((r) => (
					<Link
						key={r}
						to={RECORD_ROUTES[r]}
						params={{ id: incidentId }}
						search={true}
						viewTransition
						aria-current={here === r ? "page" : undefined}
						data-state={here === r ? "active" : "inactive"}
						className={tab(here === r)}
						data-testid={`tab-${r}`}
					>
						{NAMES[r]}
						{counts[r] !== undefined && (
							<span className="text-meta font-normal text-text-3 tabular-nums">
								{counts[r]}
							</span>
						)}
					</Link>
				))}
				{box && (
					<span
						aria-hidden
						data-testid="tab-underline"
						className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-accent transition-[left,width] duration-(--dur-fast) ease-(--ease-standard)"
						style={{ left: box.x, width: box.w }}
					/>
				)}
			</nav>
			{status && (
				<div className="ml-auto flex min-w-0 items-center">{status}</div>
			)}
		</div>
	);
}
