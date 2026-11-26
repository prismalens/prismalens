// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type AlertWithRelations, canAlertAction } from "@prismalens/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useToast } from "@/hooks/use-toast";
import { alertKeys } from "@/lib/api/hooks/use-alerts-orpc";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import type { AlertCtx } from "./alert.actions";

/** The payload as received, pretty-printed when it is JSON. */
export function prettyPayload(raw: string | null): string | null {
	if (!raw) return null;
	try {
		return JSON.stringify(JSON.parse(raw), null, 2);
	} catch {
		return raw;
	}
}

/**
 * One alert's actions, for its page and its list row alike: one set of mutations
 * per caller, a context per alert.
 */
export function useAlertCtx() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { toast } = useToast();
	const invalidate = () => {
		queryClient.invalidateQueries({ queryKey: alertKeys.all() });
		queryClient.invalidateQueries({ queryKey: incidentKeys.all() });
	};
	const fail = (title: string) => (err: unknown) =>
		toast({ title, description: getErrorMessage(err), variant: "destructive" });
	const resolve = useMutation({
		...orpc.alerts.resolve.mutationOptions(),
		onSuccess: invalidate,
		onError: fail("Could not resolve"),
	});
	const correlate = useMutation({
		...orpc.alerts.correlate.mutationOptions(),
		onSuccess: () => {
			invalidate();
			toast({
				title: "Correlated",
				description: "The alert went through the rules again.",
			});
		},
		onError: fail("Still suppressed"),
	});
	const ctxOf = (
		alert: AlertWithRelations,
		opts: { listed?: boolean; search?: Record<string, unknown> } = {},
	): AlertCtx => {
		const incident = alert.incident;
		return {
			open: () =>
				void navigate({
					to: "/alerts/$id",
					params: { id: alert.id },
					search: opts.search ?? {},
				}),
			openIncident: () =>
				incident &&
				void navigate({ to: "/incidents/$id", params: { id: incident.id } }),
			incidentLabel: incident ? `INC-${incident.number}` : "",
			resolve: () => resolve.mutate({ id: alert.id }),
			correlate: () => correlate.mutate({ id: alert.id }),
			payload: () => prettyPayload(alert.rawPayload ?? null) ?? "",
			link: `${window.location.origin}/alerts/${alert.id}`,
			facts: {
				is: {
					listed: !!opts.listed,
					hasIncident: !!incident,
					resolvable:
						canAlertAction("resolve", alert.status) && !resolve.isPending,
					uncorrelated: !incident && !correlate.isPending,
					hasPayload: !!alert.rawPayload,
				},
			},
		};
	};
	return { ctxOf, resolve, correlate };
}
