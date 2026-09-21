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

function safeEndpointUrl(rawUrl: string): string | null {
	try {
		const parsed = new URL(rawUrl);
		if (parsed.username || parsed.password) {
			return null;
		}
		return rawUrl.replace(/\/+$/, "");
	} catch {
		return null;
	}
}

export function telemetryEndpointsFrom(
	connectors: ResolvedConnector[],
): TelemetryEndpoints | undefined {
	const prom = connectors.find((c) => c.templateId === "prometheus");
	const am = connectors.find((c) => c.templateId === "alertmanager");

	const promUrl = prom ? safeEndpointUrl(prom.baseUrl) : null;
	const amUrl = am ? safeEndpointUrl(am.baseUrl) : null;

	if (!promUrl && !amUrl) return undefined;

	const endpoints: TelemetryEndpoints = {};
	if (promUrl) {
		endpoints.prometheusUrl = promUrl;
	}
	if (amUrl) {
		endpoints.alertmanagerUrl = amUrl;
	}
	return endpoints;
}
