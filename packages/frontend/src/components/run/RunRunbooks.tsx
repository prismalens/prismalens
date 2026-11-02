// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PreRunDetail, PreRunSummary } from "@prismalens/contracts";
import {
	BookOpen,
	Boxes,
	ExternalLink,
	FileText,
	FolderGit2,
	Link2,
	Search,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { preRunRead } from "./PreRunCoverage";

type Runbook = PreRunSummary["runbooks"][number];

/** Past this many the list gains search, service filters and repository groups, as Sources does (#848). */
export const MANY_RUNBOOKS = 8;

/** A file's path starts with its repository's name; a link has no repository. */
const repoOf = (r: Runbook): string | null =>
	r.link ? null : r.path.includes("/") ? (r.path.split("/")[0] ?? null) : null;

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
	runId,
	preRun,
	loadError,
}: {
	/** Keys the filters, so switching runs starts them afresh (#848). */
	runId: string;
	/** null or unavailable: a run with no snapshot (from before #848, or none was stored). */
	preRun: PreRunDetail | null;
	/** The run itself did not load: not the same as a scan that was skipped. */
	loadError?: boolean;
}) {
	const read = preRunRead(preRun);
	let body: ReactNode;
	if (loadError)
		body = (
			<p className="text-text-2" data-testid="runbooks-load-error">
				This run's runbooks did not load.
			</p>
		);
	else if (!read)
		body = (
			<p className="text-text-2" data-testid="runbooks-no-snapshot">
				This run has no snapshot, so no runbooks were listed for it.
			</p>
		);
	else if (read.runbooksSkipped)
		body = (
			<p className="text-text-2" data-testid="runbooks-skipped">
				The runbook scan was skipped: {read.runbooksSkipped}
			</p>
		);
	else if (read.runbooks.length === 0)
		body = (
			<p className="text-text-2" data-testid="runbooks-none">
				No runbook was found in the repositories this run read.
			</p>
		);
	else
		body =
			read.runbooks.length > MANY_RUNBOOKS ? (
				<ManyRunbooks key={runId} runbooks={read.runbooks} />
			) : (
				<RunbookList runbooks={read.runbooks} />
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

function RunbookList({
	runbooks,
	inRepo,
}: {
	runbooks: Runbook[];
	/** Grouped under this repository: its name is the heading, not part of each path. */
	inRepo?: string;
}) {
	return (
		<ul className="flex flex-col gap-2" data-testid="runbooks-list">
			{runbooks.map((r) => (
				<RunbookCard
					key={`${r.service}:${r.path}`}
					r={r}
					path={inRepo ? r.path.slice(inRepo.length + 1) : r.path}
				/>
			))}
		</ul>
	);
}

function RunbookCard({ r, path }: { r: Runbook; path: string }) {
	return (
		<li
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
					<p className="font-semibold [overflow-wrap:anywhere]">{r.title}</p>
					<p
						className="truncate font-mono text-mono text-text-2"
						title={r.path}
					>
						{path}
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
					<Chip icon={<Link2 className="size-3 text-text-2" aria-hidden />}>
						Link
					</Chip>
				) : (
					<Chip icon={<FileText className="size-3 text-text-2" aria-hidden />}>
						File
					</Chip>
				)}
				<Chip icon={<Boxes className="size-3 text-text-2" aria-hidden />}>
					{r.service}
				</Chip>
			</div>
		</li>
	);
}

/** Many: search and service filters, then one group per repository; links last. */
function ManyRunbooks({ runbooks }: { runbooks: Runbook[] }) {
	const [query, setQuery] = useState("");
	/** null is All: "all" is also a valid service name (#848). */
	const [service, setService] = useState<string | null>(null);
	const services = Array.from(new Set(runbooks.map((r) => r.service)));
	const q = query.trim().toLowerCase();
	const shown = runbooks.filter(
		(r) =>
			(service === null || r.service === service) &&
			(!q || `${r.title} ${r.path} ${r.service}`.toLowerCase().includes(q)),
	);
	const repos = Array.from(new Set(shown.map(repoOf)));
	repos.sort((a, b) => Number(a === null) - Number(b === null));
	return (
		<div className="flex flex-col gap-3" data-testid="runbooks-many">
			<div className="raised flex h-10 items-center gap-2 rounded-pool px-3">
				<Search className="size-4 text-text-3" aria-hidden />
				<Input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search runbooks"
					aria-label="Search runbooks"
					className="h-8 flex-1 bg-transparent px-0"
					data-testid="runbooks-search"
				/>
			</div>
			<fieldset
				aria-label="Service"
				data-scroll-x
				className="m-0 flex gap-1.5 overflow-x-auto border-0 p-0.5"
			>
				<ServiceChip
					label="All"
					count={runbooks.length}
					pressed={service === null}
					onPress={() => setService(null)}
					testId="runbooks-all"
				/>
				{services.map((s) => (
					<ServiceChip
						key={s}
						label={s}
						count={runbooks.filter((r) => r.service === s).length}
						pressed={service === s}
						onPress={() => setService(s)}
						testId={`runbooks-service-${s}`}
					/>
				))}
			</fieldset>
			{shown.length === 0 ? (
				<div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
					<p className="text-heading">Nothing matches</p>
					<p className="text-text-2">Try another name, or clear the filters.</p>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => {
							setQuery("");
							setService(null);
						}}
						data-testid="runbooks-clear"
					>
						Clear filters
					</Button>
				</div>
			) : (
				repos.map((repo) => {
					const items = shown.filter((r) => repoOf(r) === repo);
					return (
						<section
							key={repo === null ? "links" : `repo:${repo}`}
							aria-label={repo ?? "Links"}
							className="flex flex-col gap-1.5"
							data-testid="runbooks-group"
						>
							<h4 className="flex items-center gap-1.5 text-meta font-medium text-text-2">
								{repo ? (
									<FolderGit2 className="size-3.5" aria-hidden />
								) : (
									<Link2 className="size-3.5" aria-hidden />
								)}
								<span className="min-w-0 truncate">{repo ?? "Links"}</span>
								<span className="font-normal text-text-3 tabular-nums">
									{items.length}
								</span>
							</h4>
							<RunbookList runbooks={items} inRepo={repo ?? undefined} />
						</section>
					);
				})
			)}
		</div>
	);
}

function ServiceChip({
	label,
	count,
	pressed,
	onPress,
	testId,
}: {
	label: string;
	count: number;
	pressed: boolean;
	onPress: () => void;
	testId: string;
}) {
	return (
		<button
			type="button"
			aria-pressed={pressed}
			onClick={onPress}
			className={cn(
				"inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-meta font-medium whitespace-nowrap text-text-2 outline-1 -outline-offset-1 outline-text-3/50 hover:text-text-1",
				pressed && "bg-text-1 text-canvas outline-0 hover:text-canvas",
			)}
			data-testid={testId}
		>
			{label}
			<span className="tabular-nums">{count}</span>
		</button>
	);
}
