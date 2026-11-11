// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel } from "@prismalens/config/harness";
import {
	ACCESS_LEVEL_LABEL,
	type AskAnswer,
	type PendingAsk,
} from "@prismalens/contracts";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useOperator } from "@/hooks/use-operator";
import { useAnswerAsk } from "@/lib/api/hooks/use-investigations-orpc";
import { alwaysLine, askSubject, waitedFor, whyAsked } from "@/lib/ask-lines";
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
	const [mine, setMine] = useState(false);
	const ask = entry?.ask;
	const can =
		!!ask &&
		!entry?.ended &&
		!(ask.requiresHost && !onHost) &&
		(ask.kind === "permission" || ask.kind === "question");
	const send = (a: AskAnswer) => {
		if (!ask || !can || answer.isPending) return;
		setError(null);
		setMine(true);
		answer.mutate(
			{ id: ask.threadId, askId: ask.askId, answer: a },
			{
				onError: (e) => {
					setMine(false);
					setError(getErrorMessage(e));
				},
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
		mine,
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
 * A row expanded to its ask (#1101 category 8 item 2): the exact command or path,
 * Approve and Decline with their keys, Always and Deny with reason one step away.
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
	const [more, setMore] = useState(false);
	const [reason, setReason] = useState<string | null>(null);
	if (!ask) return null;
	const subject = askSubject(ask);
	const always = alwaysLine(ask);
	const who =
		ask.source.kind === "subagent" ? `${ask.source.title} asks` : "Asks";
	return (
		<div
			className="mx-1.5 mb-1.5 flex flex-col gap-1.5 rounded-control bg-surface-2 px-2.5 py-2"
			data-testid="row-ask"
			data-kind={ask.kind}
		>
			<p className="flex items-baseline gap-2 text-meta text-text-3">
				<span className="min-w-0 flex-1 truncate">
					{who} {waitedFor(ask.openedAt, now)}
					{accessLevel ? ` · ${ACCESS_LEVEL_LABEL[accessLevel]}` : ""}
				</span>
				{count > 1 && <span data-testid="row-ask-count">1 of {count}</span>}
			</p>
			<p className="text-body text-text-1">{ask.title}</p>
			{subject && (
				<code
					className="block max-h-24 overflow-y-auto whitespace-pre-wrap break-all rounded-control bg-surface-3 px-2 py-1 font-mono text-meta text-text-1"
					data-testid="row-ask-subject"
				>
					{subject}
				</code>
			)}
			<p className="text-meta text-text-3" data-testid="row-ask-why">
				{whyAsked(ask, accessLevel)}
			</p>
			{ended ? (
				<p className="text-meta text-text-2" data-testid="row-ask-ended">
					Ended with its run; nothing to answer
				</p>
			) : ask.requiresHost && !state.onHost ? (
				<p className="text-meta text-text-2">Answer on the host machine</p>
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
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							onKeyDown={(e) => e.stopPropagation()}
							className="h-7 min-w-0 flex-1 rounded-control bg-surface-4 px-2 text-meta text-text-1 outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
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
					<>
						<div className="flex flex-wrap items-center gap-1.5">
							<Button
								size="sm"
								disabled={state.busy}
								onClick={state.approve}
								aria-keyshortcuts="Y"
								data-testid="row-ask-approve"
							>
								Approve <Kbd>Y</Kbd>
							</Button>
							<Button
								size="sm"
								variant="secondary"
								disabled={state.busy}
								onClick={() => state.decline()}
								aria-keyshortcuts="N"
								data-testid="row-ask-decline"
							>
								Decline <Kbd>N</Kbd>
							</Button>
							<Button
								size="sm"
								variant="text"
								aria-expanded={more}
								onClick={() => setMore((m) => !m)}
								data-testid="row-ask-more"
							>
								More
							</Button>
						</div>
						{more && (
							<div className="flex flex-col gap-1">
								<div className="flex flex-wrap gap-1.5">
									{always && (
										<Button
											size="sm"
											variant="secondary"
											disabled={state.busy}
											onClick={state.always}
											data-testid="row-ask-always"
										>
											Always
										</Button>
									)}
									<Button
										size="sm"
										variant="secondary"
										disabled={state.busy}
										onClick={() => setReason("")}
										data-testid="row-ask-deny-reason"
									>
										Deny with reason
									</Button>
								</div>
								{always && <p className="text-meta text-text-3">{always}</p>}
							</div>
						)}
					</>
				)
			) : ask.kind === "question" && state.single ? (
				<div className="flex flex-col gap-0.5">
					{ask.questions?.[0]?.options.map((o, n) => (
						<button
							key={o.id}
							type="button"
							disabled={state.busy}
							onClick={() => state.pick(n + 1)}
							className="flex min-h-7 items-baseline gap-2 rounded-control px-2 text-left text-meta text-text-1 hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent/60"
							data-testid="row-ask-option"
						>
							<span className="font-mono text-text-3">{n + 1}</span>
							<span>{o.label}</span>
						</button>
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

/**
 * True for a while after an ask this card showed leaves without this device
 * answering it: another device or the agent closed it (#1101 category 8 item 3).
 */
export function useGone(askId: string | null, mine: boolean): boolean {
	const last = useRef<string | null>(null);
	const [gone, setGone] = useState(false);
	useEffect(() => {
		if (askId) {
			last.current = askId;
			setGone(false);
			return;
		}
		if (!last.current || mine) return;
		last.current = null;
		setGone(true);
		const t = setTimeout(() => setGone(false), 6_000);
		return () => clearTimeout(t);
	}, [askId, mine]);
	return gone;
}
