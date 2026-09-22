// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isWorkflowLive, isWorkflowTerminal } from "@prismalens/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import { useInvestigationEventsHistory } from "@/lib/api/hooks/use-investigation-events";
import { useInvestigationStream } from "@/lib/api/hooks/use-investigation-stream";
import {
	investigationKeys,
	useCancelInvestigation,
} from "@/lib/api/hooks/use-investigations-orpc";
import { orpc } from "@/lib/api/orpc-client";

export type LedgerStatus =
	| "idle"
	| "connecting"
	| "streaming"
	| "completed"
	| "failed";

/**
 * One run's state for the record and the rail: the investigation row, its
 * events (live while it runs, replayed from history after), the ledger status
 * the stream panel renders, and the polling fallback when SSE is down. The
 * stream stays subscribed until the run ends and the history takes over, so
 * the ledger never unmounts on completion (ADR-0008 §4).
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
		enabled: !!investigation && !isActive,
	});
	const events = isActive ? stream.events : (history.data ?? []);
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
		}
	}, [stream.status, id, queryClient]);

	const cancel = useCancelInvestigation();
	const failed =
		!!investigation &&
		isWorkflowTerminal(investigation.status) &&
		investigation.status !== "completed";
	const ledgerStatus: LedgerStatus = isActive
		? stream.status === "error"
			? "connecting"
			: stream.status
		: failed
			? "failed"
			: "completed";

	return {
		investigation,
		isLoading: enabled && query.isLoading,
		error: query.error,
		refetch: query.refetch,
		isRefetching: query.isRefetching,
		events,
		latestText: isActive ? stream.latestText : null,
		isActive,
		failed,
		streamFailed,
		ledgerStatus,
		jobProgress: statusData?.job?.progress ?? 0,
		jobState: statusData?.job?.state ?? null,
		cancel: () => cancel.mutate({ id }),
		isCancelling: cancel.isPending,
	};
}

export type InvestigationRun = ReturnType<typeof useInvestigationRun>;
