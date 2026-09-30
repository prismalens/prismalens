// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CanonicalEvent,
	isWorkflowLive,
	isWorkflowTerminal,
	type RunState,
	runState,
} from "@prismalens/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import { useInvestigationEventsHistory } from "@/lib/api/hooks/use-investigation-events";
import { useInvestigationStream } from "@/lib/api/hooks/use-investigation-stream";
import {
	investigationKeys,
	useCancelInvestigation,
	useSendInvestigationMessage,
} from "@/lib/api/hooks/use-investigations-orpc";
import { orpc } from "@/lib/api/orpc-client";

const eventsKey = (id: string) =>
	orpc.investigations.getEvents.key({ input: { id } });

import {
	latestAgentText,
	type PendingMessage,
	unmatchedPending,
} from "@/lib/investigation-events";

export type LedgerStatus =
	| "idle"
	| "connecting"
	| "streaming"
	| "completed"
	| "failed";

/** The API answered 409: the run ended before the message reached it. */
export function isConflict(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const e = error as { status?: unknown; code?: unknown };
	return e.status === 409 || e.code === "CONFLICT";
}

/**
 * The stored events, then the live ones, once each by `(branchId, seq)`: a
 * follow-up streams after a finished run's history (#747).
 */
export function mergeRunEvents(
	history: CanonicalEvent[],
	live: CanonicalEvent[],
): CanonicalEvent[] {
	const seen = new Set<string>();
	const out: CanonicalEvent[] = [];
	for (const e of [...history, ...live]) {
		const key =
			e.kind === "report" ? `report:${e.seq}` : `${e.branchId}:${e.seq}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(e);
	}
	return out.sort((a, b) => a.seq - b.seq);
}

/** Only an ended run takes a follow-up; a live one takes messages (#747). */
export function followUpState(
	investigation: {
		status: string;
		resumable?: boolean;
		resumeBlockedReason?: string | null;
	} | null,
): { resumable: boolean; resumeBlockedReason: string | null } {
	if (!investigation || !isWorkflowTerminal(investigation.status))
		return { resumable: false, resumeBlockedReason: null };
	return {
		resumable: !!investigation.resumable,
		resumeBlockedReason: investigation.resumeBlockedReason ?? null,
	};
}

/**
 * One run's state for the incident's layers: the investigation row, its events
 * (live while it runs, replayed from history after), the run's own state word,
 * the messages the operator sent that have not come back as events, and the
 * polling fallback when SSE is down (ADR-0008 §4, #743).
 */
export function useInvestigationRun(investigationId: string | null) {
	const queryClient = useQueryClient();
	const enabled = !!investigationId;
	const id = investigationId ?? "";

	const query = useQuery({
		...orpc.investigations.get.queryOptions({ input: { id } }),
		enabled,
	});
	const investigation = query.data ?? null;

	const isActive = !!investigation && isWorkflowLive(investigation.status);
	const stream = useInvestigationStream(id, { enabled: enabled && isActive });
	const history = useInvestigationEventsHistory(id, {
		enabled: !!investigation,
	});
	const historyEvents = history.data;
	const liveEvents = isActive ? stream.events : null;
	const events = useMemo(
		() => mergeRunEvents(historyEvents ?? [], liveEvents ?? []),
		[historyEvents, liveEvents],
	);
	const streamFailed = isActive && stream.status === "error";

	const { data: statusData } = useQuery({
		...orpc.investigations.getStatus.queryOptions({ input: { id } }),
		enabled: !!investigation,
		refetchInterval: streamFailed ? 3000 : false,
	});

	useEffect(() => {
		if (stream.status === "completed" || stream.status === "failed") {
			queryClient.invalidateQueries({
				queryKey: investigationKeys.detail(id),
			});
			queryClient.invalidateQueries({ queryKey: investigationKeys.lists() });
			queryClient.invalidateQueries({ queryKey: incidentKeys.all() });
			queryClient.invalidateQueries({ queryKey: eventsKey(id) });
		}
	}, [stream.status, id, queryClient]);

	// Stop and messages belong to one run: another selection starts clean.
	const [stopRequestedFor, setStopRequestedFor] = useState<string | null>(null);
	const [pending, setPending] = useState<{
		runId: string;
		items: PendingMessage[];
	}>({ runId: id, items: [] });
	const [undeliverable, setUndeliverable] = useState<string | null>(null);
	useEffect(() => {
		setPending({ runId: id, items: [] });
		setUndeliverable(null);
	}, [id]);

	const cancel = useCancelInvestigation();
	const message = useSendInvestigationMessage();

	const stopRequested =
		isActive && (stopRequestedFor === id || !!investigation?.stopRequestedAt);
	const failed = !!investigation && investigation.status === "failed";
	const ended = !!investigation && isWorkflowTerminal(investigation.status);
	const state: RunState | null = investigation
		? runState(investigation.status, {
				hasEvents: events.length > 0,
				stopRequested,
			})
		: null;
	const ledgerStatus: LedgerStatus = isActive
		? stream.status === "error"
			? "connecting"
			: stream.status
		: investigation && investigation.status !== "completed"
			? "failed"
			: "completed";

	const lastEventAt = events[events.length - 1]?.ts ?? null;
	const latestText = useMemo(
		() => (isActive ? stream.latestText : null) ?? latestAgentText(events),
		[isActive, stream.latestText, events],
	);

	const { mutate: cancelMutate } = cancel;
	const stop = useCallback(
		(opts?: { onError?: (error: unknown) => void }) => {
			setStopRequestedFor(id);
			cancelMutate(
				{ id },
				{
					onError: (error) => {
						setStopRequestedFor(null);
						opts?.onError?.(error);
					},
				},
			);
		},
		[cancelMutate, id],
	);

	const { mutate: messageMutate } = message;
	const sendMessage = useCallback(
		(
			text: string,
			mode: "queue" | "now",
			opts?: { branchId?: string; onError?: (error: unknown) => void },
		) => {
			const local: PendingMessage = {
				id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				text,
				mode,
				at: new Date().toISOString(),
			};
			setUndeliverable(null);
			setPending((p) => ({ runId: p.runId, items: [...p.items, local] }));
			messageMutate(
				{ id, text, mode, branchId: opts?.branchId },
				{
					// A follow-up reopened the run: refetch so it reads live and the stream connects.
					onSuccess: (result) => {
						if (result.state !== "resumed") return;
						queryClient.invalidateQueries({
							queryKey: investigationKeys.detail(id),
						});
						queryClient.invalidateQueries({ queryKey: incidentKeys.all() });
					},
					onError: (error) => {
						if (isConflict(error)) {
							setPending((p) => ({
								runId: p.runId,
								items: p.items.map((m) =>
									m.id === local.id ? { ...m, undelivered: true } : m,
								),
							}));
							setUndeliverable(text);
							return;
						}
						setPending((p) => ({
							runId: p.runId,
							items: p.items.filter((m) => m.id !== local.id),
						}));
						opts?.onError?.(error);
					},
				},
			);
		},
		[messageMutate, id, queryClient],
	);

	const pendingItems = pending.runId === id ? pending.items : [];
	const waiting = unmatchedPending(events, pendingItems).filter(
		(m) => m.mode === "queue" && !m.undelivered,
	).length;

	return {
		investigation,
		isLoading: enabled && query.isLoading,
		error: query.error,
		refetch: query.refetch,
		isRefetching: query.isRefetching,
		events,
		latestText,
		lastEventAt,
		state,
		isActive,
		ended,
		...followUpState(investigation),
		failed,
		streamFailed,
		ledgerStatus,
		jobProgress: statusData?.job?.progress ?? 0,
		jobState: statusData?.job?.state ?? null,
		stop,
		stopRequested,
		isStopping: cancel.isPending,
		sendMessage,
		isSending: message.isPending,
		pending: pendingItems,
		waiting,
		undeliverable,
		clearUndeliverable: () => setUndeliverable(null),
	};
}

export type InvestigationRun = ReturnType<typeof useInvestigationRun>;
