// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	canIncidentAction,
	type IncidentWithRelations,
	isIncidentOpen,
} from "@prismalens/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { DRAFT } from "@/components/incidents/record-context";
import { useToast } from "@/hooks/use-toast";
import { incidentKeys, timelineKeys } from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { isPlainChat } from "@/lib/trigger";
import type { IncidentCtx } from "./incident.actions";
import type { PageAct } from "./page-acts";

/** What a row can do itself; the rest opens the incident's page, which runs it (`?act=`). */
type RowOwn = Partial<
	Pick<IncidentCtx, "resolve" | "merge" | "investigateAgain">
>;

/**
 * An incident row's menu: the page's own action list (#1127). Severity and
 * navigation run here; an action that needs the page's dialog opens the page with it.
 */
export function useIncidentRowCtx() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const severity = useMutation({
		...orpc.incidents.update.mutationOptions(),
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: incidentKeys.all() }),
				queryClient.invalidateQueries({ queryKey: timelineKeys.all() }),
			]),
		onError: (error) =>
			toast({
				title: "Severity not changed",
				description: getErrorMessage(error),
				variant: "destructive",
			}),
	});
	return (incident: IncidentWithRelations, own: RowOwn = {}): IncidentCtx => {
		const page = (act?: PageAct) => () =>
			void navigate({
				to: "/incidents/$id",
				params: { id: incident.id },
				search: act ? { act } : {},
			});
		const chat = isPlainChat(incident);
		const merged = incident.mergedInto;
		return {
			open: page(),
			toggleDetails: () => {},
			detailsLabel: "Details",
			allRuns: page(),
			newConversation: () =>
				void navigate({
					to: "/incidents/$id/conversation",
					params: { id: incident.id },
					search: { investigation: DRAFT },
				}),
			resolve: own.resolve ?? page("resolve"),
			note: page("note"),
			statusUpdate: page("statusUpdate"),
			setSeverity: (v) =>
				v !== incident.severity &&
				severity.mutate({ id: incident.id, severity: v }),
			severity: incident.severity,
			investigateAgain: own.investigateAgain ?? page("investigateAgain"),
			merge: own.merge ?? page("merge"),
			exportReport: () => {},
			openMerged: () =>
				merged &&
				void navigate({ to: "/incidents/$id", params: { id: merged.id } }),
			editCause: page("editCause"),
			facts: {
				is: {
					listed: true,
					chat,
					resolvable:
						!chat && !merged && canIncidentAction("close", incident.status),
					severityEditable: !chat && !merged && !severity.isPending,
					canInvestigateAgain: !chat && !!own.investigateAgain,
					canMerge:
						!chat && !incident.mergedIntoId && isIncidentOpen(incident.status),
					merged: !!merged,
					closed: incident.status === "closed",
				},
			},
		};
	};
}
