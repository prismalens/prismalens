// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { OpenedSource } from "./open-source.js";
import {
	OffOriginError,
	SourceConfigError,
	TRUNCATED_HEADER,
} from "./source-request.js";

export type QueryKind = "prometheus" | "alertmanager" | "loki";
export const QUERY_KINDS: readonly QueryKind[] = [
	"prometheus",
	"alertmanager",
	"loki",
];

export const LIMITS = {
	/** Bytes read from an upstream response. */
	responseBytes: 4 * 1024 * 1024,
	series: 50,
	pointsPerSeries: 200,
	alerts: 100,
	logLines: 200,
	logLineChars: 2_000,
};

/** Why a request failed, without upstream text that may echo a credential. */
export function failureReason(e: unknown): string {
	if (e instanceof OffOriginError)
		return "the request would leave the source's origin; PrismaLens does not send your credential there";
	if (
		e instanceof Error &&
		(e.name === "TimeoutError" || e.name === "AbortError")
	)
		return "the source did not answer in time";
	if (e instanceof SourceConfigError) return e.message;
	return "could not connect to the source";
}

export function cap<T>(
	items: T[],
	max: number,
): { items: T[]; dropped: number } {
	return {
		items: items.slice(0, max),
		dropped: Math.max(0, items.length - max),
	};
}

/** A GET that answered; anything else throws a `QueryFailed` with PrismaLens's own reason. */
export class QueryFailed extends Error {}

/** One GET; a non-2xx body is never read, since it may echo the credential (#848, OBJ-001). */
export async function getJson(
	src: OpenedSource,
	path: string,
	params: Record<string, string>,
	signal: AbortSignal,
): Promise<unknown> {
	if (!src.request) throw new QueryFailed(src.unusable ?? "unusable");
	const qs = new URLSearchParams(params).toString();
	const res = await src.request("GET", qs ? `${path}?${qs}` : path, {
		headers: { Accept: "application/json" },
		signal,
	});
	if (res.headers.get(TRUNCATED_HEADER))
		throw new QueryFailed(
			`the response is larger than ${LIMITS.responseBytes} bytes`,
		);
	if (!res.ok) {
		await res.body?.cancel();
		throw new QueryFailed(`the source answered HTTP ${res.status}`);
	}
	return JSON.parse(await res.text());
}

const promResult = (data: unknown) => {
	const d = (data as { data?: { resultType?: string; result?: unknown } }).data;
	if (!Array.isArray(d?.result))
		return { resultType: d?.resultType, result: d?.result };
	const { items, dropped } = cap(
		d.result as Record<string, unknown>[],
		LIMITS.series,
	);
	let pointsDropped = 0;
	const result = items.map((s) => {
		if (!Array.isArray(s.values)) return s;
		const values = s.values as unknown[];
		pointsDropped += Math.max(0, values.length - LIMITS.pointsPerSeries);
		return { ...s, values: values.slice(-LIMITS.pointsPerSeries) };
	});
	return {
		resultType: d.resultType,
		result,
		...(dropped ? { seriesDropped: dropped } : {}),
		...(pointsDropped ? { pointsDropped } : {}),
	};
};

export interface SnapshotWindow {
	start: Date;
	end: Date;
	/** The incident's service, to scope the log query; absent when the incident names none. */
	service?: string;
}

export interface SnapshotPart {
	/** One line for the prompt, e.g. "3 firing alerts". */
	summary: string;
	data: unknown;
}

const unix = (d: Date) => String(Math.floor(d.getTime() / 1000));

/** The pre-run telemetry read for each kind (#848 ruling 2026-10-24): fixed, read-only queries. */
export const SNAPSHOT_QUERIES: Record<
	QueryKind,
	(
		src: OpenedSource,
		w: SnapshotWindow,
		signal: AbortSignal,
	) => Promise<SnapshotPart>
> = {
	prometheus: async (src, _w, signal) => {
		const alerts = await getJson(src, "api/v1/alerts", {}, signal);
		const list = (alerts as { data?: { alerts?: unknown[] } }).data?.alerts;
		const capped = cap(Array.isArray(list) ? list : [], LIMITS.alerts);
		const down = promResult(
			await getJson(src, "api/v1/query", { query: "up == 0" }, signal),
		);
		const downCount = Array.isArray(down.result) ? down.result.length : 0;
		return {
			summary: `${capped.items.length + capped.dropped} rule alerts pending or firing, ${downCount} scrape targets down`,
			data: {
				alerts: capped.items,
				...(capped.dropped ? { alertsDropped: capped.dropped } : {}),
				targetsDown: down,
			},
		};
	},
	alertmanager: async (src, _w, signal) => {
		const data = await getJson(
			src,
			"api/v2/alerts",
			{ active: "true", silenced: "false", inhibited: "false" },
			signal,
		);
		const { items, dropped } = cap(
			Array.isArray(data) ? data : [],
			LIMITS.alerts,
		);
		return {
			summary: `${items.length + dropped} active alerts`,
			data: { alerts: items, ...(dropped ? { alertsDropped: dropped } : {}) },
		};
	},
	loki: async (src, w, signal) => {
		const selector = w.service
			? `{service_name=${JSON.stringify(w.service)}}`
			: '{service_name=~".+"}';
		const query = `${selector} |~ "(?i)(error|exception|fatal|panic)"`;
		const data = await getJson(
			src,
			"loki/api/v1/query_range",
			{
				query,
				start: unix(w.start),
				end: unix(w.end),
				limit: String(LIMITS.logLines),
				direction: "backward",
			},
			signal,
		);
		const streams = (data as { data?: { result?: unknown } }).data?.result;
		let lines = 0;
		const result = (
			Array.isArray(streams)
				? (streams as { stream?: unknown; values?: [string, string][] }[])
				: []
		).map((s) => {
			const values = (s.values ?? []).map(([ts, line]) => [
				ts,
				line.length > LIMITS.logLineChars
					? `${line.slice(0, LIMITS.logLineChars)}…`
					: line,
			]);
			lines += values.length;
			return { stream: s.stream, values };
		});
		return {
			summary: `${lines} error log lines from ${result.length} streams`,
			data: { query, result },
		};
	},
};
