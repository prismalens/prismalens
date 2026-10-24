// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CanonicalEvent,
	type FollowUpKind,
	isWorkflowLive,
	isWorkflowTerminal,
	type RunState,
	runState,
} from "@prismalens/contracts";
import {
	replaceEqualDeep,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deriveSteps } from "@/components/run/run-steps";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import { useInvestigationEventsHistory } from "@/lib/api/hooks/use-investigation-events";
import { useInvestigationStream } from "@/lib/api/hooks/use-investigation-stream";
import {
	investigationKeys,
	useCancelInvestigation,
	useSendInvestigationMessage,
} from "@/lib/api/hooks/use-investigations-orpc";
import { orpc } from "@/lib/api/orpc-client";
import {
	type AttachmentView,
	latestAgentText,
	type PendingMessage,
	queuedMessages,
} from "@/lib/investigation-events";
import { deriveAsks } from "@/lib/run-asks";

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

/** `next`, keeping each part of the previous value it deep-equals, so unchanged steps keep identity (#874). */
export function useShared<T>(next: T): T {
	// Written after commit, never in render: a discarded render must not leave its input behind.
	const last = useRef({ next, shared: next });
	const shared =
		last.current.next === next
			? last.current.shared
			: replaceEqualDeep(last.current.shared, next);
	useEffect(() => {
		last.current = { next, shared };
	});
	return shared;
}

/** Only an ended run takes a follow-up; a live one takes messages (#747). */
export function followUpState(
	investigation: {
		status: string;
		resumable?: boolean;
		continuable?: boolean;
		resumeBlockedReason?: string | null;
	} | null,
): {
	resumable: boolean;
	continuable: boolean;
	resumeBlockedReason: string | null;
} {
	if (!investigation || !isWorkflowTerminal(investigation.status))
		return { resumable: false, continuable: false, resumeBlockedReason: null };
	return {
		resumable: !!investigation.resumable,
		continuable: !!investigation.continuable,
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
	// A follow-up can end before a refetch ever sees it live, so no stream carries its
	// events: poll the history until an event past the send lands on an ended run.
	const [followUpFrom, setFollowUpFrom] = useState<{
		runId: string;
		seq: number;
	} | null>(null);
	const awaitingFollowUp = followUpFrom?.runId === id;
	const streamFailed = isActive && stream.status === "error";
	// History is read once; while no stream carries events, they are read on from the last seq (#874).
	const history = useInvestigationEventsHistory(id, {
		enabled: !!investigation,
		pollMs: streamFailed ? 3000 : awaitingFollowUp && !isActive ? 2000 : false,
	});
	const { catchUp } = history;
	const historyEvents = history.data;
	const liveEvents = isActive ? stream.events : null;
	const events = useMemo(
		() => mergeRunEvents(historyEvents ?? [], liveEvents ?? []),
		[historyEvents, liveEvents],
	);
	const lastSeq = events[events.length - 1]?.seq ?? -1;
	const ended = !!investigation && isWorkflowTerminal(investigation.status);
	useEffect(() => {
		if (!awaitingFollowUp || isActive || !ended) return;
		if (lastSeq > (followUpFrom?.seq ?? -1)) setFollowUpFrom(null);
	}, [awaitingFollowUp, isActive, ended, lastSeq, followUpFrom]);

	const { data: statusData } = useQuery({
		...orpc.investigations.getStatus.queryOptions({ input: { id } }),
		enabled: !!investigation,
		refetchInterval: streamFailed ? 3000 : false,
	});

	const wasActive = useRef(isActive);
	const endCatchUpPending = useRef(false);
	useEffect(() => {
		// The run just ended, possibly with its stream down: read what was recorded after the last catch-up (#874).
		if (wasActive.current && !isActive) {
			endCatchUpPending.current = historyEvents === undefined;
			if (historyEvents !== undefined) catchUp().catch(() => {});
		}
		wasActive.current = isActive;
	}, [isActive, historyEvents, catchUp]);
	useEffect(() => {
		if (isActive || !endCatchUpPending.current || historyEvents === undefined)
			return;
		endCatchUpPending.current = false;
		catchUp().catch(() => {});
	}, [isActive, historyEvents, catchUp]);
	useEffect(() => {
		// The stream's first events: what was recorded between the history read and its replay.
		if (stream.status === "streaming") catchUp().catch(() => {});
		if (stream.status === "completed" || stream.status === "failed") {
			queryClient.invalidateQueries({
				queryKey: investigationKeys.detail(id),
			});
			queryClient.invalidateQueries({ queryKey: investigationKeys.lists() });
			queryClient.invalidateQueries({ queryKey: incidentKeys.all() });
			catchUp().catch(() => {});
		}
	}, [stream.status, id, queryClient, catchUp]);

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
	const state: RunState | null = investigation
		? runState(investigation.status, {
				hasEvents: events.length > 0,
				stopRequested,
			})
		: null;

	const lastEventAt = events[events.length - 1]?.ts ?? null;
	const latestText = useMemo(
		() => (isActive ? stream.latestText : null) ?? latestAgentText(events),
		[isActive, stream.latestText, events],
	);

	const { mutate: cancelMutate } = cancel;
	const stop = useCallback(
		(opts?: { onSuccess?: () => void; onError?: (error: unknown) => void }) => {
			setStopRequestedFor(id);
			cancelMutate(
				{ id },
				{
					onSuccess: () => opts?.onSuccess?.(),
					onError: (error) => {
						setStopRequestedFor(null);
						opts?.onError?.(error);
					},
				},
			);
		},
		[cancelMutate, id],
	);

	const { mutateAsync: messageSend } = message;
	/**
	 * Settles once the API answered: a 409 resolves (the text waits as undeliverable),
	 * any other failure rejects so the box keeps what was typed.
	 */
	const sendMessage = useCallback(
		async (
			text: string,
			mode: "queue" | "now",
			opts?: {
				branchId?: string;
				attachments?: AttachmentView[];
				/** What the message asks for; a live row refuses a mismatch (#673 w59). */
				kind?: FollowUpKind;
			},
		): Promise<void> => {
			const attachments = opts?.attachments ?? [];
			const local: PendingMessage = {
				id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				text,
				mode,
				at: new Date().toISOString(),
				attachments,
			};
			setUndeliverable(null);
			setPending((p) => ({ runId: p.runId, items: [...p.items, local] }));
			let result: Awaited<ReturnType<typeof messageSend>>;
			try {
				result = await messageSend({
					id,
					text,
					mode,
					branchId: opts?.branchId,
					...(opts?.kind ? { kind: opts.kind } : {}),
					...(attachments.length
						? { attachments: attachments.map((a) => a.id) }
						: {}),
				});
			} catch (error) {
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
				throw error;
			}
			const { messageId } = result;
			if (messageId)
				setPending((p) => ({
					runId: p.runId,
					items: p.items.map((m) =>
						m.id === local.id ? { ...m, messageId } : m,
					),
				}));
			// A follow-up reopened the run: refetch so it reads live and the stream connects.
			if (result.state !== "resumed") return;
			// A stop on the finished run must not read as a stop on its follow-up.
			setStopRequestedFor(null);
			setFollowUpFrom({ runId: id, seq: lastSeq });
			queryClient.invalidateQueries({ queryKey: investigationKeys.detail(id) });
			queryClient.invalidateQueries({ queryKey: incidentKeys.all() });
			catchUp().catch(() => {});
		},
		[messageSend, id, queryClient, lastSeq, catchUp],
	);

	const pendingItems = pending.runId === id ? pending.items : [];
	const queued = useMemo(
		() => (isActive ? queuedMessages(events, pendingItems) : []),
		[isActive, events, pendingItems],
	);
	const cwd = investigation?.workspace?.cwd;
	const steps = useShared(
		useMemo(
			() => deriveSteps(events, { cwd, ended: !isActive }),
			[events, cwd, isActive],
		),
	);
	const asks = useShared(
		useMemo(
			() => deriveAsks(events, steps, { live: isActive, cwd }),
			[events, steps, isActive, cwd],
		),
	);
	// The run waits on you: an ask streamed in, or the row says so (#673 w5-14).
	const awaiting =
		isActive &&
		(asks.some((a) => a.state === "waiting") ||
			(!!investigation?.awaitingApprovalAt && asks.length === 0));

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
		jobProgress: statusData?.job?.progress ?? 0,
		jobState: statusData?.job?.state ?? null,
		stop,
		stopRequested,
		isStopping: cancel.isPending,
		sendMessage,
		isSending: message.isPending,
		pending: pendingItems,
		/** Messages waiting for the agent's next pause, across reloads (#820). */
		queued,
		waiting: queued.length,
		steps,
		asks,
		awaiting,
		undeliverable,
		clearUndeliverable: () => setUndeliverable(null),
	};
}

export type InvestigationRun = ReturnType<typeof useInvestigationRun>;
