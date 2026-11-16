// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMemo } from "react";
import { cn } from "@/lib/utils";

/** Lines the stand-in draws: the first screens, until the highlighted view takes over. */
const MAX_LINES = 400;
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

type Row =
	| { kind: "hunk"; key: number; text: string }
	| {
			kind: "line";
			key: number;
			mark: " " | "+" | "-";
			old: number | null;
			new: number | null;
			text: string;
	  };

/** The patch body as numbered rows, headers dropped. */
export function standInPatchRows(patch: string, max = MAX_LINES): Row[] {
	const rows: Row[] = [];
	let o = 0;
	let n = 0;
	let inHunk = false;
	for (const raw of patch.split("\n")) {
		if (rows.length >= max) break;
		const m = HUNK.exec(raw);
		if (m) {
			o = Number(m[1]);
			n = Number(m[2]);
			inHunk = true;
			rows.push({ kind: "hunk", key: rows.length, text: raw });
			continue;
		}
		if (!inHunk) continue;
		const mark = raw[0];
		if (mark !== " " && mark !== "+" && mark !== "-") continue;
		rows.push({
			kind: "line",
			key: rows.length,
			mark,
			old: mark === "+" ? null : o++,
			new: mark === "-" ? null : n++,
			text: raw.slice(1),
		});
	}
	return rows;
}

/**
 * A file's patch as plain rows while the highlighter loads (its worker is a few hundred KB),
 * then replaced by the highlighted view: on the slow link the first patch shows from the
 * patch alone (#1101 category 16, item 7). Read-only.
 */
export function PatchStandIn({
	patch,
	wrap,
	className,
}: {
	patch: string;
	wrap: boolean;
	className?: string;
}) {
	const rows = useMemo(() => standInPatchRows(patch), [patch]);
	return (
		<div
			className={cn(
				"min-h-0 flex-1 overflow-auto bg-surface-1 font-mono text-[12px] leading-[18px] text-text-1",
				className,
			)}
			data-testid="diff-patch-stand-in"
			aria-busy="true"
		>
			{rows.map((r) =>
				r.kind === "hunk" ? (
					<div
						key={r.key}
						className="bg-surface-2 px-2 text-text-3 whitespace-pre"
					>
						{r.text}
					</div>
				) : (
					<div
						key={r.key}
						data-line={r.new ?? r.old ?? undefined}
						className={cn(
							"flex",
							r.mark === "+" && "bg-ok/12",
							r.mark === "-" && "bg-danger/12",
						)}
					>
						<span className="w-10 shrink-0 pr-2 text-right text-text-3 select-none">
							{r.old ?? ""}
						</span>
						<span className="w-10 shrink-0 pr-2 text-right text-text-3 select-none">
							{r.new ?? ""}
						</span>
						<span className="w-4 shrink-0 text-text-3 select-none">
							{r.mark === " " ? "" : r.mark}
						</span>
						<span
							className={cn(
								"min-w-0 pr-2",
								wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre",
							)}
						>
							{r.text}
						</span>
					</div>
				),
			)}
		</div>
	);
}
