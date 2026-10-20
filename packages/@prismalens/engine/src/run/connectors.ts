// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type InvestigationContext,
	type TelemetryEndpoints,
	type TelemetrySource,
	telemetrySources,
} from "@prismalens/contracts/schemas";

export interface ResolvedConnector {
	templateId: string;
	connectionId: string;
	label: string;
	baseUrl: string;
	segments: string[];
	/** Sends a credential PrismaLens holds; the agent reads it through the gateway, not curl (#848). */
	authenticated?: boolean;
}

const SOURCE_KINDS = new Set<TelemetrySource["kind"]>([
	"prometheus",
	"alertmanager",
	"loki",
]);

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

/**
 * The brief's telemetry: every usable source, plus the old single-URL fields (the shim,
 * which keeps the prompt's curl recipes) taken from the first credential-free one.
 */
export function telemetryEndpointsFrom(
	connectors: ResolvedConnector[],
	warn: (message: string) => void = () => {},
): TelemetryEndpoints | undefined {
	const sources: TelemetrySource[] = [];
	for (const c of connectors) {
		if (!SOURCE_KINDS.has(c.templateId as TelemetrySource["kind"])) continue;
		const reason = unsafeEndpointReason(c.baseUrl);
		if (reason) {
			warn(`${c.label}: ${reason}; left out of the investigation`);
			continue;
		}
		sources.push({
			kind: c.templateId as TelemetrySource["kind"],
			label: c.label,
			url: c.baseUrl.replace(/\/+$/, ""),
			...(c.authenticated ? { authenticated: true } : {}),
		});
	}
	if (!sources.length) return undefined;
	const open = (kind: TelemetrySource["kind"]) =>
		sources.find((s) => s.kind === kind && !s.authenticated)?.url;
	const promUrl = open("prometheus");
	const amUrl = open("alertmanager");
	return {
		sources,
		...(promUrl ? { prometheusUrl: promUrl } : {}),
		...(amUrl ? { alertmanagerUrl: amUrl } : {}),
	};
}

/**
 * Where a Read-only run may reach (r4 R4.1): the origin of every telemetry
 * address in the brief. A URL written without a scheme is http, so it matches
 * only an http origin (#778). An address that does not parse adds nothing.
 */
export function telemetryOrigins(
	context: Pick<InvestigationContext, "telemetry" | "logs">,
): string[] {
	const t = context.telemetry;
	const out = new Set<string>();
	for (const raw of [
		...telemetrySources(t)
			.filter((s) => !s.authenticated)
			.map((s) => s.url),
		t?.apiUrl,
		context.logs?.url,
	]) {
		if (!raw) continue;
		try {
			const url = new URL(raw);
			if (url.protocol !== "http:" && url.protocol !== "https:") continue;
			out.add(url.origin);
		} catch {
			// not an address the brief can name
		}
	}
	return [...out];
}
