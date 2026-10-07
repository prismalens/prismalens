// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { inIncident, useBack } from "@/hooks/use-back";
import { useSlidingMark } from "@/hooks/use-sliding-mark";
import { cn } from "@/lib/utils";
import { RECORD_ROUTES, type RecordRoute } from "./RecordLayout";
import { RunChip } from "./RunChip";

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
 * The incident's tabs (#743): one sliding underline; below 1280 the run chip
 * at the right end (#673). Esc is the band's chevron unless a field has it.
 */
export function RecordTabs({
	incidentId,
	here,
	counts,
}: {
	incidentId: string;
	here: RecordRoute | null;
	counts: Partial<Record<RecordRoute, number>>;
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
			className="flex h-9 shrink-0 items-center gap-x-3 px-3 max-md:pr-4 max-md:pl-4"
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
			<RunChip className="ml-auto xl:hidden [[data-sidebar-folded]_&]:inline-flex" />
		</div>
	);
}
