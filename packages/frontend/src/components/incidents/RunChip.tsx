// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronDown, Plus } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import { RunDot } from "./RunTree";
import { useIncidentRecord } from "./record-context";
import { elapsedWord, refState, runName, runNumber } from "./run-facts";

/**
 * The runs where the sidebar tree is not on screen: below 1280, folded, and
 * on the phone (#673). It is the only in-page run switcher.
 */
export function RunChip({ className }: { className?: string }) {
	const { runs, investigationId, draft, selectRun, newRun } =
		useIncidentRecord();
	const now = useNow(1000);
	const label = draft
		? "New run"
		: investigationId
			? `Run #${runNumber(runs, investigationId)}`
			: "Runs";
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className={cn(
						"inline-flex h-7 shrink-0 items-center gap-1 rounded-control bg-surface-1 px-2 text-body font-medium text-text-1 transition-colors duration-(--dur-instant) hover:bg-surface-3 data-[state=open]:bg-surface-3",
						className,
					)}
					data-testid="run-chip"
				>
					{label}
					<ChevronDown className="size-3.5 text-text-3" aria-hidden />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				{runs.map((r) => (
					<DropdownMenuItem
						key={r.id}
						onClick={() => selectRun(r.id)}
						className={cn(r.id === investigationId && "bg-surface-3")}
						data-testid="run-chip-item"
					>
						<RunDot state={refState(r)} />
						<span className="min-w-0 flex-1 truncate">{runName(runs, r)}</span>
						<span className="shrink-0 text-meta text-text-3">
							{elapsedWord(r, now)}
						</span>
					</DropdownMenuItem>
				))}
				{runs.length > 0 && <DropdownMenuSeparator />}
				<DropdownMenuItem
					onClick={() => newRun()}
					data-testid="run-chip-new"
					className="text-text-2"
				>
					<Plus className="size-3" />
					New run
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
