// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PrReplyFailure, PrReviewThread } from "@prismalens/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { forwardRef, useState } from "react";
import { Ring } from "@/components/shared/Ring";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/lib/api/orpc-client";
import { cn } from "@/lib/utils";

/** Each refusal in words; `scope` also links where a connection is re-granted. */
const FAILURE_WORD: Record<PrReplyFailure, string> = {
	scope: "The host refused: this connection can't write comments.",
	locked: "The conversation is locked on the host.",
	rejected: "The host refused the reply.",
	unreachable: "The host didn't answer. Try again; it won't post twice.",
};

interface Draft {
	text: string;
	/** One per draft: a second press or a retry reuses it, so the host gets one post. */
	key: string;
}

/** Drafts outlive closing the row and switching tabs, until posted. */
const drafts = new Map<string, Draft>();
const newKey = () =>
	globalThis.crypto?.randomUUID?.() ??
	`${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * A person's reply to one review thread, posted on the code host as them (#1101 category 15).
 * The button holds while the post is in flight; a refusal keeps the draft and says why.
 */
export const ReviewReply = forwardRef<
	HTMLTextAreaElement,
	{
		threadId: string;
		prId: string;
		thread: PrReviewThread;
		onPosted: (thread: PrReviewThread) => void;
	}
>(function ReviewReply({ threadId, prId, thread, onPosted }, ref) {
	const slot = `${prId}:${thread.id}`;
	const [draft, setDraft] = useState<Draft>(
		() => drafts.get(slot) ?? { text: "", key: newKey() },
	);
	const [sending, setSending] = useState(false);
	const [failed, setFailed] = useState<{
		failure: PrReplyFailure;
		message: string;
	} | null>(null);
	const queryClient = useQueryClient();
	const keep = (d: Draft) => {
		setDraft(d);
		if (d.text) drafts.set(slot, d);
		else drafts.delete(slot);
	};
	const send = async () => {
		const body = draft.text.trim();
		if (!body || sending) return;
		setSending(true);
		setFailed(null);
		try {
			const r = await orpc.threads.prReviewReply.call({
				id: threadId,
				prId,
				threadId: thread.id,
				body,
				clientKey: draft.key,
			});
			if (r.ok) {
				keep({ text: "", key: newKey() });
				onPosted(r.thread);
				void queryClient.invalidateQueries({
					predicate: (q) => JSON.stringify(q.queryKey).includes(threadId),
				});
			} else setFailed({ failure: r.failure, message: r.message });
		} catch {
			setFailed({
				failure: "unreachable",
				message: "PrismaLens did not answer.",
			});
		} finally {
			setSending(false);
		}
	};
	return (
		<div className="flex flex-col gap-1.5" data-testid="pr-review-reply">
			<Textarea
				ref={ref}
				value={draft.text}
				onChange={(e) => keep({ ...draft, text: e.target.value })}
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
						e.preventDefault();
						void send();
					}
				}}
				readOnly={sending}
				rows={2}
				aria-label={`Reply to ${thread.author}, posted as you on the code host`}
				placeholder="Reply as you, on the code host"
				data-testid="pr-review-reply-input"
			/>
			{failed && (
				<p
					role="alert"
					className="m-0 flex items-start gap-1.5 text-meta text-text-2"
					data-testid="pr-review-reply-notice"
					data-failure={failed.failure}
				>
					<TriangleAlert
						aria-hidden
						className="mt-0.5 size-3.5 shrink-0 text-warn"
					/>
					<span className="min-w-0">
						{FAILURE_WORD[failed.failure]}{" "}
						{failed.failure === "scope" && (
							<Link
								to="/settings"
								search={{ tab: "sources" }}
								className="text-accent hover:underline"
								data-testid="pr-review-reply-regrant"
							>
								Re-grant in Settings → Sources
							</Link>
						)}
						<span className="block text-text-3">{failed.message}</span>
					</span>
				</p>
			)}
			<span className="flex items-center gap-2">
				<Button
					size="sm"
					onClick={() => void send()}
					disabled={sending || !draft.text.trim()}
					aria-busy={sending}
					data-testid="pr-review-reply-send"
				>
					{sending && <Ring className="size-3" />}
					{sending ? "Posting" : "Reply"}
				</Button>
				<span className={cn("text-meta text-text-3", sending && "sr-only")}>
					Ctrl Enter
				</span>
			</span>
		</div>
	);
});
