// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { useAgentChoice } from "@/components/agent/agent-choice";
import { primeAside } from "@/components/thread/aside-bus";
import { docksHere } from "@/components/thread/composer/decided";
import {
	openNewThread,
	type QuoteChip,
	sendQuote,
	setNewThreadNavigator,
} from "@/components/thread/composer/quote";
import { knownAccessLevel } from "@/lib/access-levels";
import {
	useAnswerAsk,
	useInvestigation,
} from "@/lib/api/hooks/use-investigations-orpc";
import { startedByPrismaLens } from "@/lib/ask-refusal";
import { lazyPart } from "@/lib/lazy";
import { DOCK_ORDER, type LaneSlots, type SlotContext } from "./types";

// The ask dock and the quote popover load when drawn (#1101 category 12).
const AskDock = lazyPart(() =>
	import("@/components/thread/composer/AskDock").then((m) => m.AskDock),
);
const DecidedList = lazyPart(() =>
	import("@/components/thread/composer/AskDock").then((m) => m.DecidedList),
);
const QuotePopover = lazyPart(() =>
	import("@/components/thread/composer/QuotePopover").then(
		(m) => m.QuotePopover,
	),
);

/** UI 1's page slots (#1024): the ask dock and the selection's quote popover. Only UI 1 edits this file. */
export function useComposerSlots(ctx: SlotContext): LaneSlots {
	const { threadId } = ctx;
	const inv = useInvestigation(threadId ?? "").data;
	const { harnesses } = useAgentChoice();
	const navigate = useNavigate();
	const focusAsk = useRouterState({
		select: (s) => (s.location.search as { ask?: unknown }).ask,
	});
	const agent =
		harnesses.find((h) => h.id === inv?.harness)?.label ?? "The agent";
	const asks = ctx.asks.filter(docksHere);
	const answer = useAnswerAsk();
	// The oldest docked ask, when it is one question that takes typed words: Send answers it.
	const typed = [...asks].sort((a, b) =>
		a.openedAt.localeCompare(b.openedAt),
	)[0];
	const typedQ =
		typed?.kind === "question" &&
		typed.questions?.length === 1 &&
		typed.questions[0]?.allowOther
			? typed.questions[0]
			: null;
	const onQuote = useCallback(
		(q: QuoteChip) => {
			if (threadId) sendQuote(threadId, q);
		},
		[threadId],
	);
	// New thread keeps this thread's subject: its project, its service, or none.
	const subject = inv?.repositoryId
		? { project: inv.repositoryId }
		: inv?.serviceId
			? { service: inv.serviceId }
			: { none: true as const };
	const subjectKey = JSON.stringify(subject);
	// biome-ignore lint/correctness/useExhaustiveDependencies: subjectKey stands for subject.
	useEffect(() => {
		setNewThreadNavigator(
			(search, draft) =>
				void navigate({
					to: "/new",
					search: { ...(search ?? subject), draft },
				}),
		);
		return () => setNewThreadNavigator(null);
	}, [navigate, subjectKey]);
	const onNewThread = useCallback(
		(q: QuoteChip) =>
			openNewThread({
				quotes: [q],
				references: [],
				...(inv?.harness ? { harness: inv.harness as HarnessId } : {}),
				...(inv?.model ? { model: inv.model } : {}),
			}),
		[inv],
	);
	if (!threadId) return {};
	return {
		interceptor:
			typed && typedQ && ctx.live
				? async (env) => {
						const text = env.text.trim();
						if (!text) return null;
						await answer.mutateAsync({
							id: threadId,
							askId: typed.askId,
							answer: {
								kind: "question",
								answers: { [typedQ.id]: { options: [], other: text } },
							},
						});
						return { result: "sent" };
					}
				: null,
		dock: [
			asks.length
				? {
						id: "ask",
						order: DOCK_ORDER.ask,
						node: (
							<AskDock
								asks={asks}
								threadId={threadId}
								agent={agent}
								focusAskId={typeof focusAsk === "string" ? focusAsk : null}
								said={ctx.agentSaid}
								hostOnlyRun={!!inv && startedByPrismaLens(inv)}
								ended={!ctx.live}
								accessLevel={knownAccessLevel(inv?.accessLevel)}
							/>
						),
					}
				: null,
			ctx.decided?.length
				? {
						id: "decided",
						// Right under the ask it would have been.
						order: DOCK_ORDER.ask + 1,
						node: <DecidedList decided={ctx.decided} />,
					}
				: null,
		],
		banner: (
			<QuotePopover
				threadId={threadId}
				onQuote={onQuote}
				onNewThread={onNewThread}
				onAside={(q) => {
					sendQuote(threadId, q);
					primeAside(threadId);
				}}
			/>
		),
	};
}
