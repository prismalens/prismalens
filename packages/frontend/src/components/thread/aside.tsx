// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isWorkflowLive } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MessageResponse } from "@/components/ai/message";
import { Aside, type AsideEntry } from "@/components/kit";
import { useForkThread } from "@/lib/api/hooks/use-threads-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";

/** Asides kept per thread; older ones drop off the overlay. */
const KEEP = 5;

type Listener = (question: string) => void;
const listeners = new Map<string, Set<Listener>>();

/** The selection toolbar and `/btw` ask here; the page's overlay answers. */
export function askAside(threadId: string, question: string): boolean {
	const set = listeners.get(threadId);
	const q = question.trim();
	if (!set?.size || !q) return false;
	set.forEach((l) => {
		l(q);
	});
	return true;
}

const primers = new Map<string, Set<() => void>>();

/** Ask aside on a selection: the page starts `/btw ` in its composer, beside the quote. */
export function primeAside(threadId: string) {
	primers.get(threadId)?.forEach((l) => {
		l();
	});
}

export function onPrimeAside(threadId: string, l: () => void): () => void {
	const set = primers.get(threadId) ?? new Set<() => void>();
	set.add(l);
	primers.set(threadId, set);
	return () => {
		set.delete(l);
	};
}

/** `/btw <question>` from the composer, else null. */
export function btwQuestion(text: string): string | null {
	const m = /^\/btw\s+([\s\S]+)$/i.exec(text.trim());
	return m?.[1]?.trim() || null;
}

interface Entry {
	id: string;
	question: string;
	childId: string | null;
	error: string | null;
}

/** The latest agent words of a side thread, polled while it works. */
function useSideAnswer(childId: string | null) {
	const status = useQuery({
		...orpc.investigations.getStatus.queryOptions({
			input: { id: childId ?? "" },
		}),
		enabled: !!childId,
		refetchInterval: (q) =>
			q.state.data && !isWorkflowLive(q.state.data.investigation.status)
				? false
				: 1500,
	});
	const st = status.data?.investigation.status;
	const live = !st || isWorkflowLive(st);
	const events = useQuery({
		...orpc.investigations.getEvents.queryOptions({
			input: { id: childId ?? "", limit: 200 },
		}),
		enabled: !!childId,
		// The last words can land after the status says done: poll until they arrive.
		refetchInterval: (q) =>
			live ||
			!(q.state.data?.events ?? []).some(
				(e) => e.kind === "agent_step" && !!e.text?.trim(),
			)
				? 1500
				: false,
	});
	// The answer is the agent's last words, without a report block it may write.
	const words =
		(events.data?.events ?? [])
			.flatMap((e) =>
				e.kind === "agent_step" && e.text?.trim() ? [e.text.trim()] : [],
			)
			.map((t) => t.replace(/```json[\s\S]*?(```|$)/g, "").trim())
			.filter(Boolean)
			.at(-1) ?? "";
	return {
		live,
		failed: st === "failed",
		words,
	};
}

/**
 * A side question's overlay above the composer (sheet §2): it never enters this
 * transcript or its agent's context. The answer runs as a side thread under this
 * one; Keep as thread opens it.
 */
export function AsideHost({ threadId }: { threadId: string }) {
	const [entries, setEntries] = useState<Entry[]>([]);
	const [index, setIndex] = useState(0);
	const [open, setOpen] = useState(false);
	const fork = useForkThread();
	const navigate = useNavigate();
	useEffect(() => {
		const set = listeners.get(threadId) ?? new Set<Listener>();
		const l: Listener = (question) => {
			const id = crypto.randomUUID();
			setEntries((all) => {
				const next = [
					...all,
					{ id, question, childId: null, error: null },
				].slice(-KEEP);
				setIndex(next.length - 1);
				return next;
			});
			setOpen(true);
			fork.mutate(
				{ id: threadId, mode: "side", text: question },
				{
					onSuccess: (r) =>
						setEntries((all) =>
							all.map((e) =>
								e.id === id ? { ...e, childId: r.investigationId } : e,
							),
						),
					onError: (err) =>
						setEntries((all) =>
							all.map((e) =>
								e.id === id ? { ...e, error: getErrorMessage(err) } : e,
							),
						),
				},
			);
		};
		set.add(l);
		listeners.set(threadId, set);
		return () => {
			set.delete(l);
		};
	}, [threadId, fork.mutate]);
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);
	const shown = entries[index];
	const answer = useSideAnswer(shown?.childId ?? null);
	if (!open || !shown) return null;
	const view: AsideEntry[] = entries.map((e) => {
		if (e.id !== shown.id)
			return { id: e.id, question: e.question, state: "done" };
		if (e.error)
			return {
				id: e.id,
				question: e.question,
				state: "failed",
				error: e.error,
			};
		if (answer.failed && !answer.live)
			return { id: e.id, question: e.question, state: "failed" };
		if (!answer.words && (answer.live || !e.childId))
			return { id: e.id, question: e.question, state: "answering" };
		return {
			id: e.id,
			question: e.question,
			state: "done",
			answer: <MessageResponse>{answer.words}</MessageResponse>,
		};
	});
	return (
		<div
			className="absolute inset-x-0 bottom-full z-20 mb-2"
			data-testid="aside-host"
		>
			<Aside
				entries={view}
				index={index}
				onIndex={setIndex}
				onClose={() => setOpen(false)}
				onKeep={() => {
					if (shown.childId)
						void navigate({
							to: "/threads/$id",
							params: { id: shown.childId },
						});
				}}
			/>
		</div>
	);
}
