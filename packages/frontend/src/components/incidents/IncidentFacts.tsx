// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useServiceIntegrations } from "@/lib/api/hooks";
import { useIncidentRecord } from "./record-context";

/** The telemetry a run on this incident's service may query: names of the sources that are on. */
export function useTelemetryNames(serviceId: string | null | undefined) {
	const { data = [], isSuccess } = useServiceIntegrations(serviceId ?? "");
	if (!serviceId || !isSuccess) return null;
	return data
		.filter(
			(i) =>
				i.category === "observability" &&
				// On unless this service turned it off (ServiceTelemetrySection's rule).
				(!i.hasOverride ||
					(i.serviceConfig as { enabled?: boolean } | null)?.enabled !== false),
		)
		.map((i) => i.connectionName);
}

/** Whether a run worked with no repository, from the entry it wrote at start. */
export function useRanWithoutRepo(investigationId: string | null): boolean {
	const { timeline } = useIncidentRecord();
	if (!investigationId) return false;
	return timeline.some(
		(e) =>
			e.metadata?.investigationId === investigationId &&
			e.metadata?.mapped === false,
	);
}
