// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";
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
	labelChars: 512,
};

/** One source's snapshot after scrubbing; past it the oldest lines, then trailing items, go (#848). */
export const SNAPSHOT_BYTES = 262_144;
const TRUNCATED_REASON = "the 256 KiB snapshot limit";

/** A service's mapping to a connection, read leniently: unknown keys pass through (#848). */
export const MappingConfigSchema = z
	.object({
		deployment: z.string().min(1).max(64).optional().catch(undefined),
		selector: z.string().max(500).optional().catch(undefined),
		enabled: z.boolean().optional().catch(undefined),
		metric: z.string().optional().catch(undefined),
	})
	.passthrough();
export type MappingConfig = z.infer<typeof MappingConfigSchema>;

export function mappingConfig(raw: unknown): MappingConfig {
	let value = raw;
	if (typeof raw === "string") {
		try {
			value = JSON.parse(raw);
		} catch {
			value = {};
		}
	}
	const parsed = MappingConfigSchema.safeParse(value);
	return parsed.success ? parsed.data : {};
}

const MATCHER = String.raw`[A-Za-z_][A-Za-z0-9_]*\s*(?:=~|!~|!=|=)\s*"(?:[^"\\]|\\.)*"`;
const MATCHER_RE = new RegExp(MATCHER, "g");
const SELECTOR_RE = new RegExp(
	String.raw`^\{\s*${MATCHER}(?:\s*,\s*${MATCHER})*\s*,?\s*\}$`,
);

/** The matchers of a label-matcher list like `{a="b", c=~"x.*"}`; null for anything else. */
export function selectorMatchers(selector: string): string[] | null {
	const trimmed = selector.trim();
	if (!SELECTOR_RE.test(trimmed)) return null;
	return (trimmed.match(MATCHER_RE) ?? []).map((m) =>
		m.replace(/\s*(=~|!~|!=|=)\s*/, "$1"),
	);
}

function matchersOf(selector: string | undefined): string[] {
	if (selector === undefined) return [];
	const m = selectorMatchers(selector);
	if (!m)
		throw new QueryFailed(
			`the selector ${JSON.stringify(selector.slice(0, 80))} is not a label-matcher list like {app="api"}`,
		);
	return m;
}

const cut = (v: unknown) =>
	typeof v === "string" && v.length > LIMITS.labelChars
		? `${v.slice(0, LIMITS.labelChars)}…`
		: v;

/** A label map with each value cut to `LIMITS.labelChars`. */
function cutLabels(labels: unknown): unknown {
	if (!labels || typeof labels !== "object" || Array.isArray(labels))
		return labels;
	return Object.fromEntries(
		Object.entries(labels as Record<string, unknown>).map(([k, v]) => [
			k,
			cut(v),
		]),
	);
}

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
	params: Record<string, string | readonly string[]>,
	signal: AbortSignal,
): Promise<unknown> {
	if (!src.request) throw new QueryFailed(src.unusable ?? "unusable");
	const search = new URLSearchParams();
	for (const [k, v] of Object.entries(params))
		for (const one of typeof v === "string" ? [v] : v) search.append(k, one);
	const qs = search.toString();
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
	const result = items.map((raw) => {
		const s = "metric" in raw ? { ...raw, metric: cutLabels(raw.metric) } : raw;
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
	/** Items read; zero means the source answered with nothing for the window. */
	count: number;
}

const unix = (d: Date) => String(Math.floor(d.getTime() / 1000));

const seconds = (w: SnapshotWindow) =>
	Math.max(1, Math.round((w.end.getTime() - w.start.getTime()) / 1000));

/**
 * The pre-run telemetry read for each kind (#848): fixed, read-only queries over the
 * incident's window, narrowed by the mapping's selector when it has one.
 */
export const SNAPSHOT_QUERIES: Record<
	QueryKind,
	(
		src: OpenedSource,
		w: SnapshotWindow,
		signal: AbortSignal,
		selector?: string,
	) => Promise<SnapshotPart>
> = {
	prometheus: async (src, w, signal, selector) => {
		const m = matchersOf(selector);
		const d = seconds(w);
		const time = unix(w.end);
		const firingQuery = `max_over_time(ALERTS{${['alertstate="firing"', ...m].join(",")}}[${d}s])`;
		const downQuery = `min_over_time(up${m.length ? `{${m.join(",")}}` : ""}[${d}s]) == 0`;
		const firing = promResult(
			await getJson(src, "api/v1/query", { query: firingQuery, time }, signal),
		);
		const down = promResult(
			await getJson(src, "api/v1/query", { query: downQuery, time }, signal),
		);
		const n = (r: { result?: unknown }) =>
			Array.isArray(r.result) ? r.result.length : 0;
		return {
			summary: `${n(firing)} alerts firing in the window, ${n(down)} scrape targets down in the window${selector ? ` for ${selector}` : ""}`,
			data: {
				firing: { query: firingQuery, ...firing },
				down: { query: downQuery, ...down },
			},
			count: n(firing) + n(down),
		};
	},
	alertmanager: async (src, w, signal, selector) => {
		const filter = matchersOf(selector);
		const data = await getJson(
			src,
			"api/v2/alerts",
			{
				active: "true",
				silenced: "false",
				inhibited: "false",
				...(filter.length ? { filter } : {}),
			},
			signal,
		);
		const inWindow = (Array.isArray(data) ? data : []).filter((a) => {
			const { startsAt, endsAt } = (a ?? {}) as {
				startsAt?: string;
				endsAt?: string;
			};
			const started = startsAt ? Date.parse(startsAt) : Number.NaN;
			const ended = endsAt ? Date.parse(endsAt) : Number.NaN;
			return (
				(!Number.isFinite(started) || started <= w.end.getTime()) &&
				(!Number.isFinite(ended) || ended >= w.start.getTime())
			);
		});
		const { items, dropped } = cap(
			inWindow.map((a) =>
				a && typeof a === "object"
					? {
							...a,
							labels: cutLabels((a as { labels?: unknown }).labels),
							annotations: cutLabels(
								(a as { annotations?: unknown }).annotations,
							),
						}
					: a,
			),
			LIMITS.alerts,
		);
		return {
			summary: `${items.length + dropped} active alerts in the window${selector ? ` for ${selector}` : ""}`,
			data: { alerts: items, ...(dropped ? { alertsDropped: dropped } : {}) },
			count: items.length + dropped,
		};
	},
	loki: async (src, w, signal, selector) => {
		if (selector !== undefined) matchersOf(selector);
		const used =
			selector?.trim() ??
			(w.service
				? `{service_name=${JSON.stringify(w.service)}}`
				: '{service_name=~".+"}');
		const query = `${used} |~ "(?i)(error|exception|fatal|panic)"`;
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
			return { stream: cutLabels(s.stream), values };
		});
		return {
			summary: `${lines} error log lines from ${result.length} streams for ${used}${selector === undefined ? " (the default selector)" : ""}`,
			data: { query, result },
			count: lines,
		};
	},
};

type Shrinkable = Record<string, unknown>;

/** Drops the oldest half of the log lines; 0 when there are none. */
function dropOldestLines(data: Shrinkable): number {
	const result = data.result as { values: [string, string][] }[] | undefined;
	if (!Array.isArray(result)) return 0;
	const all = result
		.flatMap((s, si) => s.values.map((v, vi) => ({ si, vi, ts: v[0] })))
		// Nanosecond strings: shorter is older, then lexical order.
		.sort((a, b) => a.ts.length - b.ts.length || a.ts.localeCompare(b.ts));
	if (!all.length) return 0;
	const gone = all.slice(0, Math.ceil(all.length / 2));
	const drop = new Set(gone.map((g) => `${g.si}:${g.vi}`));
	data.result = result.map((s, si) => ({
		...s,
		values: s.values.filter((_, vi) => !drop.has(`${si}:${vi}`)),
	}));
	return gone.length;
}

/** Drops the trailing half of the longest series or alert list; 0 when every list is empty. */
function dropTrailing(data: Shrinkable): number {
	const lists: { owner: Shrinkable; key: string; items: unknown[] }[] = [];
	if (Array.isArray(data.alerts))
		lists.push({ owner: data, key: "alerts", items: data.alerts });
	for (const k of ["firing", "down"]) {
		const part = data[k] as Shrinkable | undefined;
		if (part && Array.isArray(part.result))
			lists.push({
				owner: part,
				key: "result",
				items: part.result as unknown[],
			});
	}
	if (Array.isArray(data.result))
		lists.push({ owner: data, key: "result", items: data.result as unknown[] });
	const longest = lists.sort((a, b) => b.items.length - a.items.length)[0];
	if (!longest?.items.length) return 0;
	const keep = Math.floor(longest.items.length / 2);
	longest.owner[longest.key] = longest.items.slice(0, keep);
	return longest.items.length - keep;
}

/**
 * The data, cut by halves until `render` of it fits `limit` bytes: the oldest log
 * lines first, then trailing series or alerts. `render` is the scrubbed text.
 */
export function boundSnapshot(
	data: unknown,
	render: (data: unknown) => string,
	limit = SNAPSHOT_BYTES,
): { text: string; truncated?: { dropped: number; reason: string } } {
	let text = render(data);
	if (Buffer.byteLength(text) <= limit || !data || typeof data !== "object")
		return { text };
	const copy = structuredClone(data) as Shrinkable;
	let dropped = 0;
	while (Buffer.byteLength(text) > limit) {
		const n = dropOldestLines(copy) || dropTrailing(copy);
		if (!n) break;
		dropped += n;
		text = render(copy);
	}
	return { text, truncated: { dropped, reason: TRUNCATED_REASON } };
}
