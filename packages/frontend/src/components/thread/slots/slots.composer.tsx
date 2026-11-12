// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import { AccessLevelSchema } from "@prismalens/contracts";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { useAgentChoice } from "@/components/agent/AgentPicker";
import { AskDock, docksHere } from "@/components/thread/composer/AskDock";
import { QuotePopover } from "@/components/thread/composer/QuotePopover";
import {
	openNewThread,
	type QuoteChip,
	sendQuote,
	setNewThreadNavigator,
} from "@/components/thread/composer/quote";
import { useInvestigation } from "@/lib/api/hooks/use-investigations-orpc";
import { DOCK_ORDER, type LaneSlots, type SlotContext } from "./types";

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
			(search) => void navigate({ to: "/new", search: search ?? subject }),
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
								ended={!ctx.live}
								accessLevel={
									AccessLevelSchema.safeParse(inv?.accessLevel).data ?? null
								}
							/>
						),
					}
				: null,
		],
		banner: (
			<QuotePopover
				threadId={threadId}
				onQuote={onQuote}
				onNewThread={onNewThread}
			/>
		),
	};
}
