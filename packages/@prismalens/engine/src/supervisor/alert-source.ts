/**
 * Alert source — the investigation SEED (ADR-0008 Tier-1, Phase-1).
 *
 * PrismaLens does NOT spoon-feed the agent a diagnosis; it discovers the firing
 * alert the way a real on-call would — by querying Alertmanager — and uses that
 * as the starting point for the investigation. (This mirrors PrismaLens's own
 * Alertmanager/webhook alert ingestion.)
 */

/** A firing alert, normalised from the Alertmanager v2 API. */
export interface FiringAlert {
	alertname: string;
	severity: string | null;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	startsAt: string | null;
}

function isRecord(x: unknown): x is Record<string, unknown> {
	return x !== null && typeof x === "object";
}

function asStringMap(x: unknown): Record<string, string> {
	if (!isRecord(x)) return {};
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(x)) {
		if (typeof v === "string") out[k] = v;
	}
	return out;
}

/**
 * Fetch the currently-firing alerts from an Alertmanager v2 endpoint. Returns
 * only active (not silenced/inhibited) alerts. Throws on a non-2xx or malformed
 * payload (boundary validation — AGENTS.md gate 1/2).
 */
export async function fetchFiringAlerts(
	alertmanagerUrl: string,
	signal?: AbortSignal,
): Promise<FiringAlert[]> {
	const base = alertmanagerUrl.replace(/\/$/, "");
	const url = `${base}/api/v2/alerts?active=true&silenced=false&inhibited=false`;
	const res = await fetch(url, { signal });
	if (!res.ok) {
		throw new Error(`Alertmanager ${base} returned HTTP ${res.status}`);
	}
	const data: unknown = await res.json();
	if (!Array.isArray(data)) {
		throw new Error("Alertmanager returned a non-array alerts payload");
	}
	return data
		.filter(
			(a): a is Record<string, unknown> =>
				isRecord(a) &&
				isRecord(a.status) &&
				(a.status as Record<string, unknown>).state === "active",
		)
		.map((a) => {
			const labels = asStringMap(a.labels);
			return {
				alertname: labels.alertname ?? "unknown",
				severity: labels.severity ?? null,
				labels,
				annotations: asStringMap(a.annotations),
				startsAt: typeof a.startsAt === "string" ? a.startsAt : null,
			};
		});
}
