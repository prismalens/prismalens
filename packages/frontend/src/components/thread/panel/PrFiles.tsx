// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { PatchDiff, WorkerPoolContextProvider } from "@pierre/diffs/react";
import type { PrFile, PrFiles } from "@prismalens/contracts";
import { useState } from "react";
import { TOOL_LINE, ToolLineChevron } from "@/components/kit/ToolLine";
import { CODE_STYLE, POOL } from "@/components/run/EvidenceFileView";
import { Hint } from "@/components/shared/Hint";
import { Empty, Loading, Problem } from "@/components/shared/State";
import { usePrFiles } from "@/lib/api/hooks/use-fix-thread";
import { useTheme } from "@/lib/providers/theme-provider";
import { cn } from "@/lib/utils";

const STATUS_WORD: Record<PrFile["status"], string> = {
	added: "Added",
	modified: "Modified",
	removed: "Removed",
	renamed: "Renamed",
	other: "Changed",
};

/** The host sends a file's hunks without the file header the diff view parses. */
function withHeader(f: PrFile, patch: string): string {
	const from =
		f.status === "added" ? "/dev/null" : `a/${f.previousPath ?? f.path}`;
	const to = f.status === "removed" ? "/dev/null" : `b/${f.path}`;
	return `--- ${from}\n+++ ${to}\n${patch}\n`;
}

function FileRow({ f, initialOpen }: { f: PrFile; initialOpen?: boolean }) {
	const [open, setOpen] = useState(!!initialOpen && f.patch !== null);
	const { theme } = useTheme();
	const head = (
		<>
			<Hint label={f.previousPath ? `${f.previousPath} → ${f.path}` : f.path}>
				<span className="min-w-0 flex-1 truncate font-mono text-mono text-text-1">
					{f.path}
				</span>
			</Hint>
			{f.patch === null ? (
				<Hint label="The host sent no patch, or it is over 64 KB. Open it on the host.">
					<span
						className="shrink-0 text-meta text-text-3"
						data-testid="pr-file-too-large"
					>
						Too large to show
					</span>
				</Hint>
			) : (
				<span className="shrink-0 text-meta text-text-3">
					{STATUS_WORD[f.status]}
				</span>
			)}
			<span className="shrink-0 text-meta tabular-nums">
				<span className="text-success">+{f.additions}</span>{" "}
				<span className="text-danger">−{f.deletions}</span>
			</span>
		</>
	);
	return (
		<li data-testid="pr-file-row" data-path={f.path}>
			{f.patch === null ? (
				<div className={cn(TOOL_LINE, "px-1")}>{head}</div>
			) : (
				<button
					type="button"
					className={cn(TOOL_LINE, "px-1")}
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					data-testid="pr-file-toggle"
				>
					{head}
					<ToolLineChevron open={open} />
				</button>
			)}
			{open && f.patch !== null && (
				<WorkerPoolContextProvider {...POOL}>
					<section
						aria-label={`Changes to ${f.path}, read-only`}
						className="max-h-96 overflow-auto rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent"
						style={CODE_STYLE}
						data-testid="pr-file-diff"
					>
						<PatchDiff
							patch={withHeader(f, f.patch)}
							options={{
								diffStyle: "unified",
								overflow: "wrap",
								themeType: theme === "dark" ? "dark" : "light",
								disableFileHeader: true,
							}}
						/>
					</section>
				</WorkerPoolContextProvider>
			)}
		</li>
	);
}

/** The host's answer as a list; the gallery draws it from fixtures. */
export function PrFileList({
	data: d,
	open,
}: {
	data: PrFiles;
	/** A path whose patch shows at once. */
	open?: string;
}) {
	if (d.unavailable && !d.files.length)
		return (
			<Hint label={d.unavailable}>
				<span>
					<Empty text="No files from the host" testId="pr-files-unavailable" />
				</span>
			</Hint>
		);
	if (!d.files.length) return <Empty text="No files changed" />;
	return (
		<div className="flex flex-col gap-1" data-testid="pr-files">
			<ul className="m-0 flex list-none flex-col p-0">
				{d.files.map((f) => (
					<FileRow key={f.path} f={f} initialOpen={f.path === open} />
				))}
			</ul>
			{d.truncated && (
				<p
					className="m-0 px-1 text-meta text-text-3"
					data-testid="pr-files-more"
				>
					More on the host
				</p>
			)}
		</div>
	);
}

/** The files a PR changes, read live from the host and never stored (#1176 D14). */
export function PrHostFiles({
	threadId,
	prId,
}: {
	threadId: string;
	prId: string;
}) {
	const files = usePrFiles(threadId, prId);
	if (files.isLoading) return <Loading rows={6} />;
	if (files.error || !files.data)
		return (
			<Problem text="Files didn't load" onRetry={() => void files.refetch()} />
		);
	return <PrFileList data={files.data} />;
}
