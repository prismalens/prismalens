// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PrCheckRun } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { useMemo } from "react";
import { Block } from "@/components/kit/Block";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/api/orpc-client";
import { checkExcerptBlock } from "./pr.blocks";

/** Lines per block; a block off screen skips layout, so a 10,000-line log never freezes the page. */
const CHUNK = 200;

/**
 * A check's whole log in the panel (#1101 parity): read from the host on the ask, so the
 * person reads CI here instead of leaving for the host. The host link stays for its own tools.
 */
export function CheckFullLog({
	threadId,
	prId,
	run,
	onClose,
}: {
	threadId: string;
	prId: string;
	run: PrCheckRun;
	onClose: () => void;
}) {
	const query = useQuery({
		...orpc.threads.prCheckLogFull.queryOptions({
			input: { id: threadId, prId, runId: run.id ?? "" },
		}),
		enabled: !!run.id,
		staleTime: 5 * 60_000,
		retry: false,
	});
	const log = query.data;
	const chunks = useMemo(() => {
		const lines = log?.lines ?? [];
		const out: { at: number; text: string }[] = [];
		for (let i = 0; i < lines.length; i += CHUNK)
			out.push({ at: i, text: lines.slice(i, i + CHUNK).join("\n") });
		return out;
	}, [log]);
	return (
		<section
			aria-label={`${run.name}: full log`}
			className="flex flex-col gap-1.5 rounded-control bg-surface-2 p-2"
			data-testid="pr-check-full-log"
		>
			<div className="flex items-center gap-2 text-meta text-text-2">
				<span className="min-w-0 flex-1 truncate">
					{query.isLoading
						? "Reading the whole log from the host"
						: log?.lines.length
							? `${log.lines.length.toLocaleString()} lines${log.truncated ? ", the end of a longer log" : ""}`
							: "Full log"}
				</span>
				{run.url && (
					<Hint label="Open on the host">
						<a
							href={run.url}
							target="_blank"
							rel="noreferrer"
							aria-label="Open on the host"
							className="inline-flex size-6 items-center justify-center rounded-control text-text-2 hover:bg-surface-3 hover:text-text-1"
						>
							<ExternalLink className="size-3.5" aria-hidden />
						</a>
					</Hint>
				)}
				<Hint label="Close the full log">
					<Button
						variant="text"
						size="icon-sm"
						aria-label="Close the full log"
						onClick={onClose}
					>
						<X aria-hidden />
					</Button>
				</Hint>
			</div>
			{query.isLoading ? (
				<span className="flex items-center gap-1.5 text-meta text-text-3">
					<Ring className="size-3" />
					Reading the log
				</span>
			) : query.error ? (
				<span className="text-meta text-text-3">
					The host refused the log.{" "}
					<button
						type="button"
						className="text-accent hover:underline"
						onClick={() => void query.refetch()}
					>
						Try again
					</button>
				</span>
			) : log?.unavailable && !log.lines.length ? (
				<span
					className="text-meta text-text-3"
					data-testid="pr-check-full-unavailable"
				>
					{log.unavailable}
				</span>
			) : (
				<Block
					spec={checkExcerptBlock}
					data={{ name: run.name, lines: log?.lines ?? [] }}
				>
					<section
						aria-label="Log"
						className="max-h-[60vh] overflow-y-auto rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent"
					>
						{chunks.map((c) => (
							<pre
								key={c.at}
								className="m-0 pr-8 font-mono text-mono break-all whitespace-pre-wrap text-text-2 [content-visibility:auto] [contain-intrinsic-size:auto_3000px]"
							>
								{c.text}
							</pre>
						))}
					</section>
				</Block>
			)}
		</section>
	);
}
