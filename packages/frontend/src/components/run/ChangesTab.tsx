// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { PatchDiff, WorkerPoolContextProvider } from "@pierre/diffs/react";
import { comparisonLabel, type RunWorkspace } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loading, Problem } from "@/components/shared/State";
import { orpc } from "@/lib/api/orpc-client";
import { useTheme } from "@/lib/providers/theme-provider";
import { splitPatch } from "@/lib/run-panel";
import { cn } from "@/lib/utils";
import { CODE_STYLE, POOL } from "./EvidenceFileView";

/** Below this the diff is unified: split columns need the room (VS Code's inline breakpoint). */
const SPLIT_MIN_PX = 720;

const UNAVAILABLE = {
	"source-removed":
		"The code this run read is no longer on this machine, so the change cannot be shown.",
	"commit-gone":
		"A commit of this comparison is no longer in the repository, so the change cannot be shown.",
} as const;

function useWidth<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [width, setWidth] = useState(0);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const ro = new ResizeObserver(([e]) => setWidth(e?.contentRect.width ?? 0));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	return [ref, width] as const;
}

/**
 * The Changes tab (#973): the commit pair the run recorded when it started,
 * named for what each end is, as a file list and one file's diff at a time.
 */
export function ChangesTab({
	runId,
	workspace,
}: {
	runId: string;
	workspace: RunWorkspace | null | undefined;
}) {
	const pairs = workspace?.compare ?? [];
	const [pair, setPair] = useState(0);
	const [style, setStyle] = useState<"split" | "unified">("split");
	const [file, setFile] = useState<string | null>(null);
	const [ref, width] = useWidth<HTMLDivElement>();
	const { theme } = useTheme();
	const query = useQuery({
		...orpc.investigations.getDiff.queryOptions({ input: { id: runId, pair } }),
		enabled: pairs.length > 0,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
	const diff = query.data;
	const patches = useMemo(
		() => (diff?.state === "ok" && diff.patch ? splitPatch(diff.patch) : []),
		[diff],
	);
	const files = diff?.state === "ok" ? diff.files : [];
	const shown = file ?? files[0]?.path ?? null;
	const patch = patches.find((p) => p.path === shown);
	const narrow = width > 0 && width < SPLIT_MIN_PX;
	const effective = narrow ? "unified" : style;

	if (pairs.length === 0)
		return (
			<p className="px-3 pt-3 text-text-2" data-testid="changes-none">
				This run recorded no comparison. Runs started before this view existed
				have none.
			</p>
		);
	const current = pairs[pair] ?? pairs[0];
	return (
		<div
			ref={ref}
			className="flex min-h-0 flex-1 flex-col"
			data-testid="changes-tab"
		>
			<div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pt-2.5 pb-2">
				{pairs.length > 1 ? (
					<select
						aria-label="Comparison"
						value={pair}
						onChange={(e) => {
							setPair(Number(e.target.value));
							setFile(null);
						}}
						className="h-7 min-w-0 flex-1 rounded-control bg-surface-2 px-2 text-body text-text-1"
						data-testid="changes-pair"
					>
						{pairs.map((p, i) => (
							<option key={`${p.repo}:${p.head}`} value={i}>
								{p.repo}: {comparisonLabel(p)}
							</option>
						))}
					</select>
				) : (
					current && (
						<span
							className="min-w-0 flex-1 text-text-1"
							data-testid="changes-label"
						>
							{comparisonLabel(current)}
						</span>
					)
				)}
				{!narrow && (
					<fieldset
						aria-label="Diff layout"
						className="m-0 flex gap-1 border-0 p-0"
					>
						{(["split", "unified"] as const).map((s) => (
							<button
								key={s}
								type="button"
								aria-pressed={style === s}
								onClick={() => setStyle(s)}
								className={cn(
									"h-6 rounded-[4px] px-2 text-meta transition-colors duration-(--dur-instant)",
									style === s
										? "bg-surface-3 text-text-1"
										: "text-text-2 hover:text-text-1",
								)}
								data-testid={`changes-style-${s}`}
							>
								{s === "split" ? "Split" : "Unified"}
							</button>
						))}
					</fieldset>
				)}
			</div>
			{query.isLoading ? (
				<div className="px-3">
					<Loading rows={4} />
				</div>
			) : query.error || !diff ? (
				<div className="px-3">
					<Problem text="The change did not load." />
				</div>
			) : diff.state === "unavailable" ? (
				<p className="px-3 text-text-2" data-testid="changes-unavailable">
					{UNAVAILABLE[diff.reason]}
				</p>
			) : (
				<div className="flex min-h-0 flex-1 flex-col @container">
					<ul
						aria-label="Changed files"
						className="m-0 max-h-40 shrink-0 list-none overflow-y-auto px-2 pb-2"
						data-testid="changes-files"
					>
						{files.map((f) => (
							<li key={f.path}>
								<button
									type="button"
									aria-current={f.path === shown ? "true" : undefined}
									onClick={() => setFile(f.path)}
									className={cn(
										"flex w-full items-baseline gap-2 rounded-control px-2 py-1 text-left transition-colors duration-(--dur-instant) hover:bg-surface-3",
										f.path === shown && "bg-surface-3",
									)}
								>
									<span className="min-w-0 flex-1 truncate font-mono text-mono text-text-1">
										{f.oldPath ? `${f.oldPath} to ${f.path}` : f.path}
									</span>
									<span className="shrink-0 text-meta tabular-nums">
										{f.additions === null ? (
											<span className="text-text-3">binary</span>
										) : (
											<>
												<span className="text-ok">+{f.additions}</span>{" "}
												<span className="text-danger">-{f.deletions}</span>
											</>
										)}
									</span>
								</button>
							</li>
						))}
					</ul>
					{diff.omitted === "too-large" ? (
						<p className="px-3 text-text-2" data-testid="changes-too-large">
							This change is too large to show here. The files it touched are
							listed above.
						</p>
					) : patch ? (
						<WorkerPoolContextProvider {...POOL}>
							<section
								// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must take focus to scroll by keyboard.
								tabIndex={0}
								aria-label={`Changes to ${patch.path}, read-only`}
								className="min-h-0 flex-1 overflow-auto shadow-[0_-1px_0_var(--hairline)] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
								style={CODE_STYLE}
								data-testid="changes-diff"
								data-style={effective}
							>
								<PatchDiff
									key={`${pair}:${patch.path}`}
									patch={patch.text}
									options={{
										diffStyle: effective,
										overflow: "wrap",
										themeType: theme === "dark" ? "dark" : "light",
										disableFileHeader: true,
									}}
								/>
							</section>
						</WorkerPoolContextProvider>
					) : (
						<p className="px-3 text-text-2">No changes in this comparison.</p>
					)}
				</div>
			)}
		</div>
	);
}
