// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
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
 * routes a card's link opens. Every tab keeps its place whichever is open.
 * The run's state rides at the right end of the same row. Esc walks up a
 * level, tab to Overview to the board, unless typing or a popover has it.
 */
export function RecordTabs({
	incidentId,
	here,
	counts,
	dimmed = [],
	status,
}: {
	incidentId: string;
	here: RecordRoute | null;
	counts: Partial<Record<RecordRoute, number>>;
	/** Tabs with nothing in them yet: still reachable, drawn quieter. */
	dimmed?: RecordRoute[];
	status: ReactNode;
}) {
	const navigate = useNavigate();

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
			if (here)
				navigate({
					to: "/incidents/$id",
					params: { id: incidentId },
					search: true,
					viewTransition: true,
				});
			else navigate({ to: "/incidents", viewTransition: true });
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [incidentId, here, navigate]);

	const tab = (active: boolean) =>
		cn(
			"inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2 text-body outline-none focus-visible:ring-2 focus-visible:ring-accent",
			active
				? "border-accent font-medium text-text-1"
				: "border-transparent text-text-2 hover:text-text-1",
		);

	return (
		<div
			className="flex shrink-0 flex-wrap items-center gap-x-3 border-b px-2"
			data-testid="record-tabs"
		>
			<nav
				aria-label="Incident"
				className="-mb-px flex min-w-0 items-center overflow-x-auto [scrollbar-width:none]"
			>
				<Link
					to="/incidents/$id"
					params={{ id: incidentId }}
					search={true}
					viewTransition
					aria-current={here === null ? "page" : undefined}
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
						className={cn(
							tab(here === r),
							here !== r && dimmed.includes(r) && "text-text-2/50",
						)}
						data-testid={`tab-${r}`}
					>
						{NAMES[r]}
						{counts[r] !== undefined && (
							<span className="text-meta tabular-nums text-text-2">
								{counts[r]}
							</span>
						)}
					</Link>
				))}
			</nav>
			<div className="ml-auto flex min-w-0 items-center">{status}</div>
		</div>
	);
}
