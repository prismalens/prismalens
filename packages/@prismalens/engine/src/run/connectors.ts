// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TelemetryEndpoints } from "@prismalens/contracts/schemas";

export interface ResolvedConnector {
	templateId: string;
	connectionId: string;
	label: string;
	baseUrl: string;
	segments: string[];
}

/** ADR 0007 §5: the engine port. Implemented by the API (credentials stay there); uncached; the engine never fetches. */
export interface ConnectorProvider {
	resolve(ctx: { serviceId?: string }): Promise<ResolvedConnector[]>;
}

export function telemetryEndpointsFrom(
	connectors: ResolvedConnector[],
): TelemetryEndpoints | undefined {
	const prom = connectors.find((c) => c.templateId === "prometheus");
	const am = connectors.find((c) => c.templateId === "alertmanager");

	if (!prom && !am) return undefined;

	const endpoints: TelemetryEndpoints = {};
	if (prom) {
		endpoints.prometheusUrl = prom.baseUrl.replace(/\/+$/, "");
	}
	if (am) {
		endpoints.alertmanagerUrl = am.baseUrl.replace(/\/+$/, "");
	}
	return endpoints;
}
