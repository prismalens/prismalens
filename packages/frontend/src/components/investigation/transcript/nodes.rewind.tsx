// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CanonicalEvent,
	CanonicalEventSchema,
} from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { History, TriangleAlert, Undo2 } from "lucide-react";
import { createContext, type ReactNode, useContext, useState } from "react";
import type { RewindTarget } from "@/components/thread/use-rewind";
import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/api/orpc-client";
import type { TranscriptNodeProps, TranscriptNodes } from "./types";

/** What the page tells the rewind rows: which edit is the latest, and how to open its dialog. */
export interface RewindRows {
	threadId: string;
	/** The newest edit's id, when it is not undone: only it offers Undo. */
	undoable: string | null;
	undone: ReadonlySet<string>;
	restored: ReadonlySet<string>;
	open: (target: RewindTarget) => void;
}

const RowsContext = createContext<RewindRows | null>(null);

export function RewindRowsProvider({
	value,
	children,
}: {
	value: RewindRows;
	children: ReactNode;
}) {
	return <RowsContext.Provider value={value}>{children}</RowsContext.Provider>;
}

/** The page's rows state from its events; the newest edit wins Undo. */
export function rewindRowsOf(
	events: readonly CanonicalEvent[],
): Pick<RewindRows, "undoable" | "undone" | "restored"> {
	let latest: string | null = null;
	const undone = new Set<string>();
	const restored = new Set<string>();
	for (const e of events) {
		if (e.kind === "thread_rewound") latest = e.rewindId;
		else if (e.kind === "rewind_undone") undone.add(e.rewindId);
		else if (e.kind === "rewind_restored") restored.add(e.of);
	}
	return {
		undoable: latest && !undone.has(latest) ? latest : null,
		undone,
		restored,
	};
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function Rule({ children }: { children: ReactNode }) {
	return (
		<div className="flex items-center gap-3">
			<span aria-hidden className="h-px flex-1 bg-hairline" />
			{children}
			<span aria-hidden className="h-px flex-1 bg-hairline" />
		</div>
	);
}

/** A folded turn read back: muted, read-only, words only. */
function FoldedTurns({
	threadId,
	rewindId,
}: {
	threadId: string;
	rewindId: string;
}) {
	const q = useQuery(
		orpc.threads.rewindFolded.queryOptions({
			input: { id: threadId, rewindId },
		}),
	);
	if (q.isPending) return <p className="text-meta text-text-3">Loading</p>;
	if (q.isError)
		return (
			<p className="text-meta text-danger">Couldn't read the folded turns</p>
		);
	const lines = q.data.events.flatMap((raw, i) => {
		const p = CanonicalEventSchema.safeParse(raw);
		if (!p.success) return [];
		const e = p.data;
		if (e.kind === "operator_message")
			return [{ key: `${i}`, who: "You", text: e.text }];
		if (e.kind === "agent_step" && e.text.trim())
			return [{ key: `${i}`, who: "Agent", text: e.text.trim() }];
		return [];
	});
	if (!lines.length)
		return (
			<p className="text-meta text-text-3">No words in the folded turns</p>
		);
	return (
		<ul
			className="space-y-2 rounded-control bg-surface-2 p-3 text-body text-text-3"
			data-testid="rewind-folded"
		>
			{lines.map((l) => (
				<li key={l.key} className="whitespace-pre-wrap break-words">
					<span className="text-meta">{l.who}: </span>
					{l.text}
				</li>
			))}
		</ul>
	);
}

/** "Edited · 3 turns folded · Show · Undo" where the edit cut the thread back (#1193). */
function RewoundRow({ event }: TranscriptNodeProps) {
	const e = event as Extract<CanonicalEvent, { kind: "thread_rewound" }>;
	const rows = useContext(RowsContext);
	const [shown, setShown] = useState(false);
	const undone = rows?.undone.has(e.rewindId) ?? false;
	const turns = e.turns ?? 0;
	return (
		<div
			className="space-y-2"
			data-testid="rewind-fold"
			data-undone={undone || undefined}
		>
			<Rule>
				<span className="flex items-center gap-1.5 text-meta text-text-3">
					<History aria-hidden className="size-3.5 shrink-0" />
					<span>
						{undone ? "Edit undone" : "Edited"} · {plural(turns, "turn")} folded
						{e.reverted.length > 0 &&
							` · ${plural(e.reverted.length, "file")} set back`}
					</span>
					{rows && (
						<Button
							variant="text"
							size="xs"
							onClick={() => setShown((s) => !s)}
							aria-expanded={shown}
							data-testid="rewind-fold-show"
						>
							{shown ? "Hide" : "Show"}
						</Button>
					)}
					{rows?.undoable === e.rewindId && (
						<Button
							variant="text"
							size="xs"
							onClick={() =>
								rows.open({ mode: "undo", rewindId: e.rewindId, turns })
							}
							data-testid="rewind-fold-undo"
						>
							<Undo2 aria-hidden />
							Undo
						</Button>
					)}
				</span>
			</Rule>
			{shown && rows && (
				<FoldedTurns threadId={rows.threadId} rewindId={e.rewindId} />
			)}
		</div>
	);
}

function UndoneRow({ event }: TranscriptNodeProps) {
	const e = event as Extract<CanonicalEvent, { kind: "rewind_undone" }>;
	return (
		<Rule>
			<span className="text-meta text-text-3" data-testid="rewind-undone">
				Edit undone · {plural(e.restored.length, "file")} restored
				{e.kept.length > 0 && `, ${e.kept.length} kept`}
			</span>
		</Rule>
	);
}

/** A rewind, undo or restore cut off by a restart: its files may be half written (#1193 R16). */
function InterruptedRow({ event }: TranscriptNodeProps) {
	const e = event as Extract<CanonicalEvent, { kind: "rewind_interrupted" }>;
	const rows = useContext(RowsContext);
	const restored = rows?.restored.has(e.op) ?? false;
	return (
		<div
			className="flex flex-wrap items-center gap-1.5 text-meta text-text-2"
			data-testid="rewind-interrupted"
		>
			<TriangleAlert aria-hidden className="size-3.5 shrink-0 text-warn" />
			<span>
				Rewind interrupted · {plural(e.written.length, "file")} may have changed
				{restored && " · restored"}
			</span>
			{rows && !restored && (
				<Button
					variant="text"
					size="xs"
					onClick={() => rows.open({ mode: "restore", op: e.op })}
					data-testid="rewind-interrupted-restore"
				>
					Restore
				</Button>
			)}
		</div>
	);
}

function RestoredRow({ event }: TranscriptNodeProps) {
	const e = event as Extract<CanonicalEvent, { kind: "rewind_restored" }>;
	return (
		<Rule>
			<span className="text-meta text-text-3" data-testid="rewind-restored">
				Restored from the backup · {plural(e.restored.length, "file")}
				{e.kept.length > 0 && `, ${e.kept.length} kept`}
			</span>
		</Rule>
	);
}

/** Edit-and-rewind's markers (#1193). */
export const rewindNodes = {
	thread_rewound: { Node: RewoundRow },
	rewind_undone: { Node: UndoneRow },
	rewind_interrupted: { Node: InterruptedRow },
	rewind_restored: { Node: RestoredRow },
} satisfies TranscriptNodes;
