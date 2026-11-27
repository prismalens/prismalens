// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel } from "@prismalens/config/harness";
import type { AskAnswer, PendingAsk } from "@prismalens/contracts";
import { useEffect, useState } from "react";
import { useOperator } from "@/hooks/use-operator";
import {
	useAnswerAsk,
	useAnsweredHere,
} from "@/lib/api/hooks/use-investigations-orpc";
import { getErrorMessage } from "@/lib/get-error-message";
import { cn } from "@/lib/utils";

export interface RowAskEntry {
	ask: PendingAsk;
	ended: boolean;
	accessLevel: AccessLevel | null;
}

/** Answering one ask from a list row: the keys and the buttons share this. */
export function useRowAsk(entry: RowAskEntry | undefined) {
	const answer = useAnswerAsk();
	const { managesPairing: onHost } = useOperator();
	const [error, setError] = useState<string | null>(null);
	const ask = entry?.ask;
	const can =
		!!ask &&
		!entry?.ended &&
		!(ask.requiresHost && !onHost) &&
		(ask.kind === "permission" || ask.kind === "question");
	const send = (a: AskAnswer) => {
		if (!ask || !can || answer.isPending) return;
		setError(null);
		answer.mutate(
			{ id: ask.threadId, askId: ask.askId, answer: a },
			{
				onError: (e) => setError(getErrorMessage(e)),
			},
		);
	};
	const single =
		ask?.kind === "question" &&
		ask.questions?.length === 1 &&
		!ask.questions[0]?.multiSelect;
	return {
		ask,
		can,
		onHost,
		busy: answer.isPending,
		error,
		approve: () =>
			ask?.kind === "permission" &&
			send({ kind: "permission", decision: "approve", scope: "once" }),
		always: () =>
			ask?.kind === "permission" &&
			send({ kind: "permission", decision: "approve", scope: "always" }),
		decline: (reason?: string) =>
			send(
				ask?.kind === "permission"
					? {
							kind: "permission",
							decision: "deny",
							...(reason?.trim() ? { reason: reason.trim() } : {}),
						}
					: { kind: "decline" },
			),
		/** Number keys pick an option of a one-question ask; null when n picks nothing. */
		pick: (n: number) => {
			const q = single ? ask?.questions?.[0] : undefined;
			const opt = q?.options[n - 1];
			if (!q || !opt) return false;
			send({ kind: "question", answers: { [q.id]: { options: [opt.id] } } });
			return true;
		},
		single,
	};
}

export type RowAskState = ReturnType<typeof useRowAsk>;

export function Kbd({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		// The button's name stays its verb; the key reaches screen readers as aria-keyshortcuts.
		<kbd
			aria-hidden
			className={cn(
				"rounded-[4px] bg-surface-4 px-1 font-mono text-[11px] text-text-2 leading-4",
				className,
			)}
		>
			{children}
		</kbd>
	);
}

/** How long a row says who answered its ask after the ask leaves. */
const ANSWER_NOTE_MS = 6_000;
/** The ask each thread's row last showed; module-wide so a row that moves sections keeps it. */
const lastAsk = new Map<string, { askId: string; goneAt: number | null }>();

/**
 * Who answered the ask a row just showed, for a while after it leaves (#1101 category 8
 * item 3): this device from any surface, or another device (or the agent closed it).
 */
export function useAnswerNote(
	threadId: string,
	askId: string | null,
): "here" | "elsewhere" | null {
	const answered = useAnsweredHere();
	const [note, setNote] = useState<string | null>(() => {
		const s = lastAsk.get(threadId);
		return s?.goneAt && Date.now() - s.goneAt < ANSWER_NOTE_MS ? s.askId : null;
	});
	useEffect(() => {
		if (askId) {
			lastAsk.set(threadId, { askId, goneAt: null });
			setNote(null);
			return;
		}
		const s = lastAsk.get(threadId);
		if (!s) return;
		s.goneAt ??= Date.now();
		const left = s.goneAt + ANSWER_NOTE_MS - Date.now();
		const clear = () => {
			lastAsk.delete(threadId);
			setNote(null);
		};
		if (left <= 0) return clear();
		setNote(s.askId);
		const t = setTimeout(clear, left);
		return () => clearTimeout(t);
	}, [threadId, askId]);
	if (!note || askId) return null;
	return answered.some((a) => a.askId === note) ? "here" : "elsewhere";
}
