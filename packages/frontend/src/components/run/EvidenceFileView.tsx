// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import { Loading, Problem } from "@/components/shared/State";
import { orpc } from "@/lib/api/orpc-client";
import { type FileAt, unavailableSentence } from "@/lib/evidence-files";
import { cn } from "@/lib/utils";

/**
 * A file the run read, read-only at the commit it recorded (proposal item 2).
 * On a phone it covers the screen; Back returns to the citation that opened it.
 */
export function EvidenceFileView({
	runId,
	file,
	onBack,
	backLabel,
	phone,
}: {
	runId: string;
	file: FileAt;
	onBack: () => void;
	backLabel: string;
	phone: boolean;
}) {
	const query = useQuery({
		...orpc.investigations.getBlob.queryOptions({
			input: { id: runId, sha: file.sha, path: file.path },
		}),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
	const blob = query.data;
	const target = useRef<HTMLLIElement>(null);
	useEffect(() => {
		if (blob?.state === "ok")
			target.current?.scrollIntoView({ block: "center" });
	}, [blob]);
	const lines =
		blob?.state === "ok" && blob.kind === "file" && blob.content !== null
			? blob.content.replace(/\n$/, "").split("\n")
			: null;
	return (
		<section
			aria-label={`${file.path} at ${file.sha.slice(0, 7)}`}
			className={cn(
				"flex min-h-0 flex-1 flex-col bg-surface-1",
				phone && "fixed inset-0 z-50",
			)}
			data-testid="evidence-file"
		>
			<div className="flex shrink-0 flex-col gap-0.5 px-3 pt-2.5 pb-2 shadow-[0_1px_0_var(--hairline)]">
				<button
					type="button"
					onClick={onBack}
					className="flex items-center gap-1 self-start text-meta text-accent hover:underline"
					data-testid="evidence-file-back"
				>
					<ChevronLeft className="size-3.5" aria-hidden />
					{backLabel}
				</button>
				<span className="truncate font-mono text-mono text-text-1">
					{file.path}
				</span>
				<span className="text-meta text-text-3">
					{file.repo} @ {file.sha.slice(0, 7)}, read-only
				</span>
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				{query.isLoading ? (
					<div className="px-3 pt-3">
						<Loading rows={6} />
					</div>
				) : query.error || !blob ? (
					<Problem
						className="px-3 pt-3"
						text="This file did not load."
						onRetry={() => query.refetch()}
					/>
				) : blob.state === "unavailable" ? (
					<p
						className="px-3 pt-3 text-text-2"
						data-testid="evidence-file-unavailable"
						data-reason={blob.reason}
					>
						{unavailableSentence(blob.reason, blob.sha)}
					</p>
				) : blob.kind === "symlink" ? (
					<p
						className="px-3 pt-3 text-text-2"
						data-testid="evidence-file-symlink"
					>
						A symlink to{" "}
						<code className="font-mono text-mono text-text-1">
							{blob.content}
						</code>
						. Shown as text; PrismaLens does not follow it.
					</p>
				) : !lines ? (
					<p className="px-3 pt-3 text-text-2">
						{blob.omitted === "binary"
							? "A binary file; nothing to show as text."
							: `Too large to show here (${Math.round(blob.size / 1024)} KB).`}
					</p>
				) : (
					<ol
						className="m-0 list-none py-2 font-mono text-mono"
						data-testid="evidence-file-lines"
					>
						{lines.map((text, i) => {
							const n = i + 1;
							const hit = n === file.line;
							return (
								<li
									// biome-ignore lint/suspicious/noArrayIndexKey: a line's number is its identity.
									key={i}
									ref={hit ? target : undefined}
									className={cn(
										"flex gap-3 px-3",
										hit && "bg-[oklch(from_var(--accent)_l_c_h/0.16)]",
									)}
									data-line={n}
									data-active={hit ? "" : undefined}
								>
									<span className="w-9 shrink-0 text-right text-text-3 tabular-nums select-none">
										{n}
									</span>
									<span className="whitespace-pre text-text-1">{text}</span>
								</li>
							);
						})}
					</ol>
				)}
			</div>
		</section>
	);
}
