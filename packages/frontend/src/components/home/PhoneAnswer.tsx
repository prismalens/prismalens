// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { markLook } from "@/components/kit/marks";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import type { RowAskEntry } from "@/components/shell/RowAsk";
import { Button } from "@/components/ui/button";
import { useOperator } from "@/hooks/use-operator";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { cn } from "@/lib/utils";

export type Decision = "approve" | "deny";

/** One card's answer: sending until the host returns it, then delivered or failed. */
export interface CardAnswer {
	entry: RowAskEntry;
	decision: Decision;
	phase: "sending" | "delivered" | "failed";
	error?: string;
}

export interface CardAnswers {
	byThread: Readonly<Record<string, CardAnswer>>;
	send: (entry: RowAskEntry, decision: Decision) => void;
	onHost: boolean;
}

/** How long a delivered answer stays on its row before the list moves on. */
const HOLD_MS = 3_000;

/**
 * Approve or deny from phone Home (#1101 category 5): no optimistic removal; the
 * card turns green only when the host's answer call returns, red with a retry when it fails.
 */
export function useCardAnswers(): CardAnswers {
	const client = useQueryClient();
	const { managesPairing: onHost } = useOperator();
	const answer = useMutation(orpc.investigations.answerAsk.mutationOptions());
	const [byThread, setByThread] = useState<Record<string, CardAnswer>>({});
	const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
	const put = useCallback((id: string, next: CardAnswer | null) => {
		setByThread((all) => {
			const { [id]: _, ...rest } = all;
			return next ? { ...rest, [id]: next } : rest;
		});
	}, []);
	const send = useCallback(
		(entry: RowAskEntry, decision: Decision) => {
			const { ask } = entry;
			const id = ask.threadId;
			clearTimeout(timers.current.get(id));
			put(id, { entry, decision, phase: "sending" });
			answer.mutate(
				{
					id,
					askId: ask.askId,
					answer:
						decision === "approve"
							? { kind: "permission", decision: "approve", scope: "once" }
							: { kind: "permission", decision: "deny" },
				},
				{
					onSuccess: () => {
						put(id, { entry, decision, phase: "delivered" });
						timers.current.set(
							id,
							setTimeout(() => {
								put(id, null);
								void client.invalidateQueries({ queryKey: orpc.threads.key() });
							}, HOLD_MS),
						);
					},
					onError: (e) =>
						put(id, {
							entry,
							decision,
							phase: "failed",
							error: getErrorMessage(e),
						}),
				},
			);
		},
		[answer, client, put],
	);
	return { byThread, send, onHost };
}

/** Whether this device may answer the ask from its card. */
export function answerable(entry: RowAskEntry | undefined, onHost: boolean) {
	return (
		!!entry &&
		!entry.ended &&
		entry.ask.kind === "permission" &&
		!(entry.ask.requiresHost && !onHost)
	);
}

const WORD: Record<Decision, string> = { approve: "Approved", deny: "Denied" };

/** The card's answer row: Approve and Deny, then the answer's mark until the host confirms. */
export function CardAnswerRow({
	entry,
	sent,
	onSend,
}: {
	entry: RowAskEntry;
	sent?: CardAnswer;
	onSend: (entry: RowAskEntry, decision: Decision) => void;
}) {
	if (sent && sent.phase !== "failed") {
		const delivered = sent.phase === "delivered";
		const look = markLook("answer", sent.phase);
		const Icon = look.icon;
		const label = delivered
			? `${WORD[sent.decision]}, the host has it`
			: "Waiting for the host";
		return (
			<div
				className="flex min-h-11 items-center gap-2 px-2 text-meta"
				role="status"
				aria-label={label}
				data-testid="phone-answer"
				data-phase={sent.phase}
			>
				<Hint label={label}>
					<span
						className={cn(
							"flex size-5 items-center justify-center",
							look.className,
						)}
					>
						{delivered ? (
							<Icon aria-hidden className="size-4" />
						) : (
							<Ring className="size-4 text-accent" />
						)}
					</span>
				</Hint>
				<span className={delivered ? "font-medium text-text-1" : "text-text-2"}>
					{delivered ? WORD[sent.decision] : "Sending"}
				</span>
			</div>
		);
	}
	const failed = sent?.phase === "failed";
	const look = markLook("answer", "failed");
	const Icon = look.icon;
	// A failed answer retries as sent; the other button stays the other choice.
	const first: Decision = failed ? sent.decision : "approve";
	const other: Decision = first === "approve" ? "deny" : "approve";
	return (
		<div className="flex flex-col gap-1 px-2 pb-1" data-testid="phone-answer">
			{failed && (
				<p
					className="flex items-center gap-1.5 text-meta text-text-1"
					role="alert"
					data-testid="phone-answer-failed"
				>
					<Icon
						aria-hidden
						className={cn("size-3.5 shrink-0", look.className)}
					/>
					<span className="min-w-0 truncate">Not delivered</span>
					<span className="sr-only">: {sent.error}</span>
				</p>
			)}
			<div className="flex items-center gap-2">
				<Button
					variant="primary"
					className="min-h-11 flex-1"
					onClick={() => onSend(entry, first)}
					data-testid={failed ? "phone-answer-retry" : "phone-answer-approve"}
				>
					{failed ? "Retry" : "Approve"}
				</Button>
				<Button
					variant="secondary"
					className="min-h-11 flex-1"
					onClick={() => onSend(entry, other)}
					data-testid={`phone-answer-${other}`}
				>
					{other === "deny" ? "Deny" : "Approve"}
				</Button>
			</div>
		</div>
	);
}
