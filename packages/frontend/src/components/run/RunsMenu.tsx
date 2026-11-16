// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import { Check, ChevronDown } from "lucide-react";
import { RunDot } from "@/components/incidents/RunTree";
import { DRAFT, type RunRef } from "@/components/incidents/record-context";
import { FAMILY_CLASS, SURFACE } from "@/components/kit/Popover";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import { refRunState, runAge, runLabel } from "./run-labels";

/**
 * Every run and question of one incident, newest first, then New
 * conversation (#811). The one runs menu every page uses; the overview is
 * never in it (reached from the breadcrumb and the sidebar). Radix gives the
 * arrow-key roving and Esc.
 */
export function RunsMenu({
	incidentId,
	runs,
	current,
	className,
}: {
	incidentId: string;
	/** Newest first. */
	runs: RunRef[];
	/** The run this page shows; `DRAFT` on a new conversation. */
	current?: string | null;
	className?: string;
}) {
	const now = useNow(10_000);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label="Runs"
					className={cn(
						"inline-flex h-7 shrink-0 items-center gap-1 rounded-control px-2 text-body text-text-2 outline-none max-md:hidden transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-3",
						className,
					)}
					data-testid="runs-menu"
				>
					Runs
					<ChevronDown className="size-3 text-text-3" aria-hidden />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				sideOffset={6}
				className={cn(SURFACE, FAMILY_CLASS.picker, "p-1")}
				data-testid="runs-menu-list"
			>
				{runs.map((r) => {
					const on = r.id === current;
					return (
						<DropdownMenuItem
							key={r.id}
							asChild
							className="h-8 gap-2 px-2 focus:bg-surface-3"
						>
							<Link
								to="/incidents/$id/conversation"
								params={{ id: incidentId }}
								search={{ investigation: r.id }}
								aria-current={on ? "page" : undefined}
								data-testid="runs-menu-item"
								data-run={r.id}
							>
								<RunDot state={refRunState(r)} />
								<span className="min-w-0 flex-1 truncate">
									{runLabel(runs, r)}
								</span>
								<span className="shrink-0 text-meta text-text-3 tabular-nums">
									{runAge(r, now)}
								</span>
								{on && <Check aria-label="Current" className="size-3.5" />}
							</Link>
						</DropdownMenuItem>
					);
				})}
				<DropdownMenuItem
					asChild
					className="h-8 px-2 pl-[22px] text-text-2 focus:bg-surface-3"
				>
					<Link
						to="/incidents/$id/conversation"
						params={{ id: incidentId }}
						search={{ investigation: DRAFT }}
						aria-current={current === DRAFT ? "page" : undefined}
						data-testid="runs-menu-new"
					>
						New conversation
					</Link>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
