// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { useOperator } from "@/hooks/use-operator";
import { useLiveRefreshInterval } from "../live-refresh";
import { orpc } from "../orpc-client";

/** The token webhook senders present; the host's own session reads it, a paired phone does not. */
export function useWebhookToken() {
	const { managesPairing } = useOperator();
	return useQuery({
		...orpc.webhooks.token.queryOptions({ input: {} }),
		enabled: managesPairing,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}

/** When the webhook last took a delivery, re-read while the change stream is down. */
export function useLastDelivery() {
	return useQuery({
		...orpc.webhooks.lastDelivery.queryOptions({ input: {} }),
		refetchInterval: useLiveRefreshInterval(),
	});
}

/** The Alertmanager receiver URL for this address, the one a stranger pastes. */
export function webhookUrl(kind: "prometheus" | "generic"): string {
	const origin = typeof window === "undefined" ? "" : window.location.origin;
	return `${origin}/api/webhooks/${kind}`;
}

/** `plw_7f3a…c91e`: enough to recognise, not enough to use. */
export function maskToken(token: string): string {
	return token.length > 12 ? `${token.slice(0, 8)}…${token.slice(-4)}` : "…";
}
