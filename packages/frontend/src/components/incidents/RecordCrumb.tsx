// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { CARD_ROUTES, type CardRoute } from "./cards/Card";

const NAMES: Record<CardRoute, string> = {
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
 * The line under the band and strip on a route below the incident (#743 §3c):
 * back to the incident, the route you are on, the others. Esc goes back
 * unless the operator is typing or a popover has it.
 */
export function RecordCrumb({
	incidentId,
	here,
}: {
	incidentId: string;
	here: CardRoute;
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
			navigate({
				to: "/incidents/$id",
				params: { id: incidentId },
				search: true,
				viewTransition: true,
			});
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [incidentId, navigate]);

	return (
		<nav
			aria-label="Incident routes"
			className="hidden h-8 shrink-0 items-center gap-3 border-b px-3 text-meta text-muted-foreground lg:flex"
			data-testid="record-crumb"
		>
			<Link
				to="/incidents/$id"
				params={{ id: incidentId }}
				search={true}
				viewTransition
				className="inline-flex items-center gap-0.5 text-primary hover:underline"
				data-testid="crumb-incident"
			>
				<ChevronLeft className="h-3.5 w-3.5" />
				Incident
			</Link>
			<span className="font-medium text-foreground">{NAMES[here]}</span>
			<span className="ml-auto flex items-center gap-3">
				{(Object.keys(NAMES) as CardRoute[])
					.filter((r) => r !== here)
					.map((r) => (
						<Link
							key={r}
							to={CARD_ROUTES[r]}
							params={{ id: incidentId }}
							search={true}
							viewTransition
							className={cn("text-primary hover:underline")}
							data-testid={`crumb-${r}`}
						>
							{NAMES[r]}
						</Link>
					))}
				<span className="flex items-center gap-1">
					<kbd className="inline-flex h-4 items-center rounded border bg-muted px-1 font-mono text-[10px] text-foreground">
						Esc
					</kbd>
					back
				</span>
			</span>
		</nav>
	);
}
