// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { FileContents } from "@pierre/diffs";
import {
	CodeView,
	type CodeViewHandle,
	WorkerPoolContextProvider,
} from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import { Loading, Problem } from "@/components/shared/State";
import { orpc } from "@/lib/api/orpc-client";
import {
	type FileAt,
	linesWord,
	sizeWord,
	unavailableSentence,
} from "@/lib/evidence-files";
import { useTheme } from "@/lib/providers/theme-provider";
import { cn } from "@/lib/utils";

/** Above this, the file is drawn uncoloured: highlighting, not transfer, is the cost. Not yet measured. */
const PLAIN_TEXT_OVER = 256 * 1024;

export const POOL = {
	poolOptions: { workerFactory: () => new DiffsWorker(), poolSize: 2 },
	// WebAssembly is blocked by the app's CSP (no 'wasm-unsafe-eval'), so the JS regex engine.
	highlighterOptions: { preferredHighlighter: "shiki-js" as const },
};

export const CODE_STYLE = {
	"--diffs-font-family": "var(--font-mono)",
	"--diffs-font-size": "12px",
	"--diffs-line-height": "18px",
	"--diffs-light-bg": "var(--surface-1)",
	"--diffs-dark-bg": "var(--surface-1)",
	"--diffs-bg-selection-override": "oklch(from var(--accent) l c h / 0.16)",
} as CSSProperties;

/**
 * A file the run read, read-only at the commit it recorded, drawn by
 * `@pierre/diffs` with the cited range selected. The states around the code
 * are PrismaLens's sentences; the library renders content only.
 */
export function EvidenceFileView({
	runId,
	file,
	onBack,
	backLabel,
	reads,
	onJump,
	codeHost,
	backRef,
}: {
	runId: string;
	file: FileAt;
	onBack: () => void;
	backLabel: string;
	/** The read steps that saw this file. */
	reads: number[];
	onJump: (n: number) => void;
	codeHost: string | null;
	backRef?: React.Ref<HTMLButtonElement>;
}) {
	const query = useQuery({
		...orpc.investigations.getBlob.queryOptions({
			input: { id: runId, sha: file.sha, path: file.path },
		}),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
	const blob = query.data;
	const sha7 = file.sha.slice(0, 7);
	const ok = blob?.state === "ok";
	const lines = ok ? linesWord(file) : null;
	const large =
		ok && blob.content !== null && blob.kind === "file"
			? blob.size > PLAIN_TEXT_OVER
			: false;
	return (
		<section
			aria-label={`${file.path} at ${sha7}`}
			className="flex min-h-0 flex-1 flex-col bg-surface-1"
			data-testid="evidence-file"
		>
			<div className="flex shrink-0 flex-col gap-0.5 px-3 pt-2.5 pb-2 shadow-[0_1px_0_var(--hairline)]">
				<button
					ref={backRef}
					type="button"
					onClick={onBack}
					className="flex items-center gap-1 self-start rounded-control text-meta text-accent hover:underline"
					id="evidence-file-back"
					data-testid="evidence-file-back"
				>
					<ChevronLeft className="size-3.5" aria-hidden />
					{backLabel}
				</button>
				<span
					className="font-mono text-mono text-text-1 [overflow-wrap:anywhere]"
					data-testid="evidence-file-title"
				>
					{file.path}{" "}
					<span className="text-text-2">
						at {sha7}
						{lines ? `, ${lines}` : ""}
					</span>
				</span>
				<span className="text-meta text-text-3">
					{file.repo}, as cloned for this run. Read-only.
				</span>
				{large && blob?.state === "ok" && (
					<span
						className="text-meta text-text-3"
						data-testid="evidence-file-plain"
					>
						{sizeWord(blob.size)}, shown as plain text: large files are not
						highlighted.
					</span>
				)}
				{codeHost && (
					<a
						href={codeHost}
						target="_blank"
						rel="noreferrer"
						className="self-start text-meta text-text-3 underline underline-offset-[3px] hover:text-text-2"
						data-testid="evidence-file-host"
					>
						Open on code host
					</a>
				)}
				{reads.length > 0 && (
					<div className="mt-1 flex flex-wrap items-center gap-1.5">
						<span className="text-meta text-text-3">
							What the agent saw is in
						</span>
						{reads.map((n) => (
							<button
								key={n}
								type="button"
								onClick={() => onJump(n)}
								className="h-[22px] rounded-full bg-surface-3 px-2 text-meta text-accent transition-colors duration-(--dur-instant) hover:bg-surface-4"
								data-testid="evidence-file-step"
							>
								Step {n}
							</button>
						))}
					</div>
				)}
			</div>
			{query.isLoading ? (
				<div className="min-h-0 flex-1 overflow-auto px-3 pt-3">
					<Loading rows={6} />
				</div>
			) : query.error || !blob ? (
				<Problem
					className="px-3 pt-3"
					text="Unable to load this file."
					onRetry={() => query.refetch()}
				/>
			) : blob.state === "unavailable" ? (
				<Say testId="evidence-file-unavailable" reason={blob.reason}>
					{unavailableSentence(blob.reason, blob.sha)}
				</Say>
			) : blob.kind === "symlink" ? (
				<Say testId="evidence-file-symlink">
					A symlink to{" "}
					<code className="font-mono text-mono text-text-1">
						{blob.content}
					</code>
					. Shown as text; PrismaLens does not follow it.
				</Say>
			) : blob.content === null ? (
				<Say testId="evidence-file-omitted" reason={blob.omitted ?? undefined}>
					{blob.omitted === "too-large"
						? `Too large to show here (${sizeWord(blob.size)}). Files over 1 MB are named, not sent.`
						: "This file is binary or not UTF-8 text, so it is not shown."}
				</Say>
			) : (
				<Code
					file={file}
					contents={blob.content}
					oid={blob.oid}
					plain={large}
				/>
			)}
		</section>
	);
}

function Say({
	children,
	testId,
	reason,
}: {
	children: React.ReactNode;
	testId: string;
	reason?: string;
}) {
	return (
		<p
			className="m-0 px-3 pt-3 text-text-2"
			data-testid={testId}
			data-reason={reason}
		>
			{children}
		</p>
	);
}

/** The library's code region, which has no role, label or tab stop of its own; ours supplies them. */
function Code({
	file,
	contents,
	oid,
	plain,
}: {
	file: FileAt;
	contents: string;
	oid: string;
	plain: boolean;
}) {
	const { theme } = useTheme();
	const view = useRef<CodeViewHandle<undefined, undefined>>(null);
	const item = useMemo(() => {
		const f: FileContents = {
			name: file.path,
			contents,
			cacheKey: oid,
			...(plain ? { lang: "text" as const } : {}),
		};
		return [{ id: oid, type: "file" as const, file: f }];
	}, [file.path, contents, oid, plain]);
	const start = file.line;
	const end = file.end ?? file.line;
	const range = useMemo(
		() => (start !== null ? { start, end: end ?? start } : null),
		[start, end],
	);
	useEffect(() => {
		if (!range) return;
		const t = window.setTimeout(
			() =>
				view.current?.scrollTo({
					type: "range",
					id: oid,
					range,
					align: "center",
				}),
			0,
		);
		return () => window.clearTimeout(t);
	}, [oid, range]);
	const sha7 = file.sha.slice(0, 7);
	return (
		<WorkerPoolContextProvider {...POOL}>
			<section
				// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must take focus to scroll by keyboard.
				tabIndex={0}
				aria-label={`${file.path} at ${sha7}, read-only`}
				className="flex min-h-0 flex-1 flex-col outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
				style={CODE_STYLE}
				data-testid="evidence-file-code"
				data-first={range?.start}
			>
				{range && <span className="sr-only">Cited {linesWord(file)}.</span>}
				<CodeView
					ref={view}
					items={item}
					className="min-h-0 flex-1 overflow-auto"
					selectedLines={range ? { id: oid, range } : null}
					options={{
						overflow: "wrap",
						themeType: theme === "dark" ? "dark" : "light",
						disableFileHeader: true,
						preferredHighlighter: "shiki-js",
					}}
				/>
			</section>
		</WorkerPoolContextProvider>
	);
}
