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

/** Why a base URL cannot go into the prompt: it carries a secret slot (userinfo, query, fragment) or does not parse. */
function unsafeEndpointReason(rawUrl: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		return "base URL does not parse";
	}
	if (parsed.username || parsed.password) return "base URL carries credentials";
	if (parsed.search || parsed.hash)
		return "base URL carries a query or fragment";
	return null;
}

export function telemetryEndpointsFrom(
	connectors: ResolvedConnector[],
	warn: (message: string) => void = () => {},
): TelemetryEndpoints | undefined {
	const usable = (templateId: string): string | undefined => {
		const c = connectors.find((x) => x.templateId === templateId);
		if (!c) return undefined;
		const reason = unsafeEndpointReason(c.baseUrl);
		if (reason) {
			warn(`${c.label}: ${reason}; left out of the investigation`);
			return undefined;
		}
		return c.baseUrl.replace(/\/+$/, "");
	};
	const promUrl = usable("prometheus");
	const amUrl = usable("alertmanager");
	if (!promUrl && !amUrl) return undefined;
	return {
		...(promUrl ? { prometheusUrl: promUrl } : {}),
		...(amUrl ? { alertmanagerUrl: amUrl } : {}),
	};
}
