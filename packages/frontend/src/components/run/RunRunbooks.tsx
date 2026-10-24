// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PreRunSummary } from "@prismalens/contracts";
import { BookOpen, Boxes, ExternalLink, FileText, Link2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Runbook = PreRunSummary["runbooks"][number];

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<span className="inline-flex h-[22px] max-w-full items-center gap-1.5 rounded-control bg-surface-3 px-2 text-meta">
			{icon}
			<span className="truncate">{children}</span>
		</span>
	);
}

/**
 * The runbooks this run found before it started (#848): title, path, an
 * origin chip (File, or Link when it points elsewhere) and the service. It
 * reads only this run's snapshot and never switches to another run.
 */
export function RunRunbooks({
	preRun,
	loadError,
}: {
	/** null: a run with no snapshot (from before #848, or none was stored). */
	preRun: PreRunSummary | null;
	/** The run itself did not load: not the same as a scan that was skipped. */
	loadError?: boolean;
}) {
	let body: ReactNode;
	if (loadError)
		body = (
			<p className="text-text-2" data-testid="runbooks-load-error">
				This run's runbooks did not load.
			</p>
		);
	else if (!preRun)
		body = (
			<p className="text-text-2" data-testid="runbooks-no-snapshot">
				This run has no snapshot, so no runbooks were listed for it.
			</p>
		);
	else if (preRun.runbooksSkipped)
		body = (
			<p className="text-text-2" data-testid="runbooks-skipped">
				The runbook scan was skipped: {preRun.runbooksSkipped}
			</p>
		);
	else if (preRun.runbooks.length === 0)
		body = (
			<p className="text-text-2" data-testid="runbooks-none">
				No runbook was found in the repositories this run read.
			</p>
		);
	else
		body = (
			<ul className="flex flex-col gap-2" data-testid="runbooks-list">
				{preRun.runbooks.map((r: Runbook) => (
					<li
						key={`${r.service}:${r.path}`}
						className="raised flex flex-col gap-2 rounded-pool p-3"
						data-testid="runbook-card"
					>
						<div className="flex items-start gap-2.5">
							<span
								aria-hidden
								className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-well-in-pool text-text-2"
							>
								<BookOpen className="size-4" />
							</span>
							<div className="min-w-0 flex-1">
								<p className="font-semibold [overflow-wrap:anywhere]">
									{r.title}
								</p>
								<p className="truncate font-mono text-mono text-text-2">
									{r.path}
								</p>
							</div>
							{r.link && (
								<Button variant="secondary" size="sm" asChild>
									<a href={r.link} target="_blank" rel="noreferrer">
										<ExternalLink className="size-3.5" />
										Open
									</a>
								</Button>
							)}
						</div>
						<div className="flex flex-wrap gap-1.5">
							{r.link ? (
								<Chip
									icon={<Link2 className="size-3 text-text-2" aria-hidden />}
								>
									Link
								</Chip>
							) : (
								<Chip
									icon={<FileText className="size-3 text-text-2" aria-hidden />}
								>
									File
								</Chip>
							)}
							<Chip icon={<Boxes className="size-3 text-text-2" aria-hidden />}>
								{r.service}
							</Chip>
						</div>
					</li>
				))}
			</ul>
		);
	return (
		<section
			className="mb-4 flex flex-col gap-1.5"
			aria-label="Runbooks"
			data-testid="run-runbooks"
		>
			<h3 className="text-meta font-semibold text-text-2">
				Runbooks found by this run
			</h3>
			{body}
		</section>
	);
}
