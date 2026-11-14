// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel } from "@prismalens/config/harness";
import {
	ACCESS_LEVEL_LABEL,
	type AskAnswer,
	type PendingAsk,
} from "@prismalens/contracts";
import { MessageSquareX, MoreHorizontal, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Menu, type MenuEntry } from "@/components/kit/Menu";
import { Status } from "@/components/kit/Status";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { useOperator } from "@/hooks/use-operator";
import {
	useAnswerAsk,
	useAnsweredHere,
} from "@/lib/api/hooks/use-investigations-orpc";
import { alwaysLine, askSubject, waitedFor, whyAsked } from "@/lib/ask-lines";
import { askRefusal } from "@/lib/ask-refusal";
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

/**
 * A waiting ask in the card beside its row (sheet §1; #1101 category 8 item 2): the
 * exact command or path, Approve and Decline, Always and Deny with reason under ⋯.
 * Its keys live in the row (Y, N, 1 to 9) and in the hints, never on the buttons.
 */
export function RowAsk({
	state,
	ended,
	accessLevel,
	now,
	count,
	openHref,
}: {
	state: RowAskState;
	ended: boolean;
	accessLevel: AccessLevel | null;
	now: number;
	/** Asks this thread holds; the card shows the oldest. */
	count: number;
	openHref: () => void;
}) {
	const { ask } = state;
	const [reason, setReason] = useState<string | null>(null);
	if (!ask) return null;
	const subject = askSubject(ask);
	const always = alwaysLine(ask);
	const who =
		ask.source.kind === "subagent" ? `${ask.source.title} asks` : "Asks";
	const more: MenuEntry[] = [
		...(always
			? [
					{
						id: "always",
						label: "Always allow",
						icon: ShieldCheck,
						onSelect: state.always,
					},
				]
			: []),
		{
			id: "deny-reason",
			label: "Deny with reason",
			icon: MessageSquareX,
			onSelect: () => setReason(""),
		},
	];
	return (
		<div
			className="flex flex-col gap-2"
			data-testid="row-ask"
			data-kind={ask.kind}
		>
			<p className="flex items-center gap-1.5 text-meta text-text-3">
				<Status
					kind={ask.kind === "question" ? "question" : "approval"}
					showWord={false}
				/>
				<span className="min-w-0 flex-1 truncate">
					{who} · {waitedFor(ask.openedAt, now)}
					{accessLevel && (
						<Hint label={whyAsked(ask, accessLevel)}>
							<span data-testid="row-ask-mode">
								{" "}
								· {ACCESS_LEVEL_LABEL[accessLevel]}
							</span>
						</Hint>
					)}
				</span>
				{count > 1 && <span data-testid="row-ask-count">1 of {count}</span>}
			</p>
			<p className="text-body font-medium text-text-1">{ask.title}</p>
			{subject && (
				<code
					className="block max-h-24 overflow-y-auto whitespace-pre-wrap break-all rounded-control bg-surface-3 px-2 py-1 font-mono text-meta text-text-1"
					data-testid="row-ask-subject"
				>
					{subject}
				</code>
			)}
			{ended ? (
				<p className="text-meta text-text-2" data-testid="row-ask-ended">
					Ended
				</p>
			) : ask.requiresHost && !state.onHost ? (
				<p className="text-meta text-text-2">{askRefusal(ask, false)?.text}</p>
			) : ask.kind === "permission" ? (
				reason !== null ? (
					<form
						className="flex items-center gap-1.5"
						onSubmit={(e) => {
							e.preventDefault();
							state.decline(reason);
						}}
					>
						<input
							// biome-ignore lint/a11y/noAutofocus: the reason is the one thing to type.
							autoFocus
							aria-label="Reason"
							placeholder="Reason"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							onKeyDown={(e) => e.stopPropagation()}
							className="h-7 min-w-0 flex-1 rounded-control bg-surface-3 px-2 text-meta text-text-1 outline-none placeholder:text-text-3 focus-visible:ring-2 focus-visible:ring-accent"
							data-testid="row-ask-reason"
						/>
						<Button
							type="submit"
							size="sm"
							variant="secondary"
							disabled={state.busy}
						>
							Deny
						</Button>
					</form>
				) : (
					<div className="flex items-center gap-1.5">
						<Hint label="Approve" keys={["Y"]}>
							<Button
								size="sm"
								variant="primary"
								disabled={state.busy}
								onClick={state.approve}
								aria-keyshortcuts="Y"
								data-testid="row-ask-approve"
							>
								Approve
							</Button>
						</Hint>
						<Hint label="Decline" keys={["N"]}>
							<Button
								size="sm"
								variant="secondary"
								disabled={state.busy}
								onClick={() => state.decline()}
								aria-keyshortcuts="N"
								data-testid="row-ask-decline"
							>
								Decline
							</Button>
						</Hint>
						<span className="flex-1" />
						<Menu
							label="More answers"
							entries={more}
							trigger={
								<button
									type="button"
									aria-label="More answers"
									className="flex size-6 items-center justify-center rounded-control text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-3"
									data-testid="row-ask-more"
								>
									<MoreHorizontal className="size-3.5" />
								</button>
							}
						/>
					</div>
				)
			) : ask.kind === "question" && state.single ? (
				<div className="flex flex-col">
					{ask.questions?.[0]?.options.map((o, n) => (
						<Hint
							key={o.id}
							label={o.label}
							keys={[String(n + 1)]}
							side="right"
						>
							<button
								type="button"
								disabled={state.busy}
								onClick={() => state.pick(n + 1)}
								className="flex min-h-7 items-center rounded-control px-2 text-left text-body text-text-1 outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent"
								data-testid="row-ask-option"
							>
								{o.label}
							</button>
						</Hint>
					))}
				</div>
			) : (
				<Button
					size="sm"
					variant="secondary"
					className="self-start"
					onClick={openHref}
				>
					Open to answer
				</Button>
			)}
			{state.error && (
				<p className="text-meta text-danger" role="alert">
					{state.error}
				</p>
			)}
		</div>
	);
}

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
