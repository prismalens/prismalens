// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { FileDiff } from "lucide-react";
import { useState } from "react";
import { TOOL_LINE, ToolLineChevron } from "@/components/kit/ToolLine";
import { shortPath } from "@/lib/report-view";
import type { TurnSummary } from "@/lib/turn-summary";
import { cn } from "@/lib/utils";

const FILES_SHOWN = 6;

/**
 * What ends a finished turn (#1101 cat 9): one summary line, and when the turn
 * edited files, a flat line with the count and lines added and removed; it
 * opens to the files, and Open diff shows them whole (sheet §2).
 */
export function TurnEnd({
	summary,
	cwd,
	onOpenDiff,
}: {
	summary: TurnSummary;
	cwd?: string | null;
	onOpenDiff?: () => void;
}) {
	const [open, setOpen] = useState(false);
	const files = summary.files;
	return (
		<li className="flex min-w-0 flex-col" data-testid="turn-end">
			<p className="text-meta text-text-3" data-testid="turn-summary">
				{summary.text}
			</p>
			{files.length > 0 && (
				<div className="group/turn min-w-0" data-testid="turn-changes">
					<div className="flex min-w-0 items-center gap-2">
						<button
							type="button"
							onClick={() => setOpen((o) => !o)}
							aria-expanded={open}
							className={cn(TOOL_LINE, "flex-1")}
							data-testid="turn-changes-toggle"
						>
							<FileDiff
								aria-hidden
								className="size-3.5 shrink-0 stroke-[1.75] text-text-3"
							/>
							<span className="shrink-0">
								Changed {files.length} {files.length === 1 ? "file" : "files"}
							</span>
							<span className="shrink-0 font-mono text-mono tabular-nums">
								<span className="text-ok">+{summary.add}</span>{" "}
								<span className="text-danger">−{summary.del}</span>
							</span>
							<span className="flex-1" />
							<ToolLineChevron open={open} />
						</button>
						{onOpenDiff && (
							<button
								type="button"
								onClick={onOpenDiff}
								className="shrink-0 rounded-control px-1.5 text-meta text-text-2 outline-none hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
								data-testid="turn-changes-open"
							>
								Open diff
							</button>
						)}
					</div>
					{open && (
						<ul className="m-0 flex list-none flex-col p-0 pb-1 pl-[22px]">
							{files.slice(0, FILES_SHOWN).map((f) => (
								<li
									key={f.path}
									className="flex h-6 min-w-0 items-center gap-2 font-mono text-mono"
									data-testid="turn-changes-file"
								>
									<span className="min-w-0 flex-1 truncate text-text-2">
										{shortPath(f.path, cwd)}
									</span>
									<span className="shrink-0 text-ok tabular-nums">
										+{f.add}
									</span>
									<span className="shrink-0 text-danger tabular-nums">
										−{f.del}
									</span>
								</li>
							))}
							{files.length > FILES_SHOWN && (
								<li className="text-meta text-text-3">
									{files.length - FILES_SHOWN} more in the diff
								</li>
							)}
						</ul>
					)}
				</div>
			)}
		</li>
	);
}
