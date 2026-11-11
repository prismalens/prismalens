// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronRight, FileDiff } from "lucide-react";
import { useState } from "react";
import { shortPath } from "@/lib/report-view";
import type { TurnSummary } from "@/lib/turn-summary";
import { cn } from "@/lib/utils";

const FILES_SHOWN = 6;

/**
 * What ends a finished turn (#1101 cat 9): one summary line, and when the turn edited
 * files, a card with the count and lines added and removed that opens the diff.
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
		<li className="flex flex-col gap-2" data-testid="turn-end">
			<p className="px-3 text-meta text-text-3" data-testid="turn-summary">
				{summary.text}
			</p>
			{files.length > 0 && (
				<div
					className="flex flex-col overflow-hidden rounded-surface bg-surface-1"
					data-testid="turn-changes"
				>
					<div className="flex min-h-9 items-center gap-2.5 px-3">
						<button
							type="button"
							onClick={() => setOpen((o) => !o)}
							aria-expanded={open}
							className="flex min-h-6 min-w-0 flex-1 items-center gap-2 text-left text-text-1"
							data-testid="turn-changes-toggle"
						>
							<ChevronRight
								aria-hidden
								className={cn(
									"size-3 shrink-0 text-text-3 transition-transform duration-(--dur-fast) motion-reduce:transition-none",
									open && "rotate-90",
								)}
							/>
							<FileDiff aria-hidden className="size-3.5 shrink-0 text-text-3" />
							<span className="truncate">
								{files.length} changed {files.length === 1 ? "file" : "files"}
							</span>
							<span className="shrink-0 text-meta text-ok tabular-nums">
								+{summary.add}
							</span>
							<span className="shrink-0 text-meta text-danger tabular-nums">
								−{summary.del}
							</span>
						</button>
						{onOpenDiff && (
							<button
								type="button"
								onClick={onOpenDiff}
								className="shrink-0 text-meta text-accent underline-offset-[3px] hover:underline"
								data-testid="turn-changes-open"
							>
								Open diff
							</button>
						)}
					</div>
					{open && (
						<ul className="m-0 flex list-none flex-col gap-0.5 bg-[linear-gradient(var(--hairline),var(--hairline))] bg-[length:100%_1px] bg-no-repeat p-0 px-3 pt-1.5 pb-2">
							{files.slice(0, FILES_SHOWN).map((f) => (
								<li
									key={f.path}
									className="flex min-w-0 items-center gap-2 text-meta"
									data-testid="turn-changes-file"
								>
									<span className="min-w-0 flex-1 truncate font-mono text-text-2">
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
