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
		selector: z.string().optional().catch(undefined),
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

const SELECTOR_MAX = 500;
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
	// Too long is refused here, not dropped at parse, so the unit is skipped rather than widened (#848).
	if (selector.length > SELECTOR_MAX)
		throw new QueryFailed(
			`the selector is longer than ${SELECTOR_MAX} characters`,
		);
	const m = selectorMatchers(selector);
	if (!m)
		throw new QueryFailed(
			`the selector ${JSON.stringify(selector.slice(0, 80))} is not a label-matcher list like {app="api"}`,
		);
	return m;
}

const cut = (v: unknown, max = LIMITS.labelChars) =>
	typeof v === "string" && v.length > max ? `${v.slice(0, max)}…` : v;

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

const UNSHOWN_ADDRESS = "an address PrismaLens cannot show";

const parseUrl = (text: string): URL | null => {
	try {
		const u = new URL(text);
		return u.host ? u : null;
	} catch {
		return null;
	}
};

/** Fail closed: an address that does not parse is never echoed (#848). */
export function redactAddress(text: string): string {
	const trimmed = text.trim();
	const u = parseUrl(trimmed);
	if (!u) return UNSHOWN_ADDRESS;
	const bare = u.pathname === "/" && !/\/[?#]|\/$/.test(trimmed);
	u.username = u.password = u.search = u.hash = "";
	return bare ? u.href.replace(/\/$/, "") : u.href;
}

const hostOf = (address: string): string =>
	parseUrl(redactAddress(address))?.host ?? UNSHOWN_ADDRESS;

// Every Sources error text starts with one of these; a stored one that does not is pre-#848 (#848).
const REACH = "Could not reach ";
const CREDENTIAL = "Could not use the saved credential for ";
const SOURCE_AT = "The source at ";
const CHECK_FAILED = "the check failed";
const FIXED_PREFIXES = [REACH, CREDENTIAL, SOURCE_AT, CHECK_FAILED];

const UNREACHABLE_CODES = new Set([
	"ECONNREFUSED",
	"ENOTFOUND",
	"EAI_AGAIN",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"ECONNRESET",
]);
const TIMEOUT_CODES = new Set([
	"ETIMEDOUT",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_HEADERS_TIMEOUT",
	"UND_ERR_BODY_TIMEOUT",
]);
const TLS_CODE =
	/^(?:CERT_|DEPTH_ZERO_|SELF_SIGNED_|UNABLE_TO_(?:VERIFY|GET)_|ERR_TLS_|ERR_SSL_|HOSTNAME_MISMATCH)/;

function signalsOf(err: unknown): { codes: string[]; names: string[] } {
	const codes: string[] = [];
	const names: string[] = [];
	let e: unknown = err;
	for (
		let i = 0;
		i < 4 && e && typeof e === "object";
		i++, e = (e as { cause?: unknown }).cause
	) {
		const { code, name } = e as { code?: unknown; name?: unknown };
		if (typeof code === "string") codes.push(code);
		if (typeof name === "string") names.push(name);
	}
	return { codes, names };
}

function statusOf(err: unknown): number | null {
	const status = (err as { status?: unknown } | null)?.status;
	if (typeof status === "number" && status >= 100 && status <= 599)
		return status;
	const m =
		err instanceof QueryFailed && /answered HTTP (\d{3})\b/.exec(err.message);
	return m ? Number(m[1]) : null;
}

export const sourceAnswered = (address: string, status: number): string =>
	`${SOURCE_AT}${hostOf(address)} answered ${status}`;

/**
 * What a failed check says: one fixed sentence per cause, with only the host in it.
 * Upstream and driver message text is never read into it (#848).
 */
export function sourceErrorText(err: unknown, address: string): string {
	const host = hostOf(address);
	if (err instanceof OffOriginError)
		return `${REACH}${host}: it redirected elsewhere, which PrismaLens does not follow`;
	if (err instanceof SourceConfigError) return `${CREDENTIAL}${host}`;
	const status = statusOf(err);
	if (status !== null) return sourceAnswered(address, status);
	const { codes, names } = signalsOf(err);
	if (codes.some((c) => TLS_CODE.test(c)))
		return `${REACH}${host}: its TLS certificate was not accepted`;
	if (
		codes.some((c) => TIMEOUT_CODES.has(c)) ||
		names.some((n) => n === "TimeoutError" || n === "AbortError")
	)
		return `${REACH}${host}: no answer in time`;
	if (
		codes.some((c) => UNREACHABLE_CODES.has(c)) ||
		(err instanceof TypeError && err.message === "fetch failed")
	)
		return `${REACH}${host}: connection refused or host not found`;
	if (names.includes("SyntaxError") || names.includes("ZodError"))
		return `${SOURCE_AT}${host} sent a response this kind of source does not give`;
	return CHECK_FAILED;
}

export const storedErrorText = (stored: string): string =>
	FIXED_PREFIXES.some((p) => stored.startsWith(p))
		? stored
		: "the last check failed";

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
		const { items, dropped } = cap(inWindow, LIMITS.alerts);
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
			const values = s.values ?? [];
			lines += values.length;
			return { stream: s.stream, values };
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
	if (Buffer.byteLength(text) <= limit) return { text };
	let dropped = 0;
	if (data && typeof data === "object") {
		const copy = structuredClone(data) as Shrinkable;
		while (Buffer.byteLength(text) > limit) {
			const n = dropOldestLines(copy) || dropTrailing(copy);
			if (!n) break;
			dropped += n;
			text = render(copy);
		}
	}
	if (Buffer.byteLength(text) > limit)
		text = render({ omitted: TRUNCATED_REASON });
	// `render` adds its own header, which can be over the limit by itself (#848).
	if (Buffer.byteLength(text) > limit)
		text = JSON.stringify({ omitted: TRUNCATED_REASON });
	return { text, truncated: { dropped, reason: TRUNCATED_REASON } };
}

/** Every string in `v` cut to `LIMITS.labelChars`, for metadata that rides on each render. */
export function cutStrings(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(cutStrings);
	if (v && typeof v === "object")
		return Object.fromEntries(
			Object.entries(v).map(([k, x]) => [k, cutStrings(x)]),
		);
	return cut(v);
}

const LABEL_KEYS = new Set(["metric", "labels", "annotations", "stream"]);

/** Label values and log lines cut to their limits. Run it on scrubbed data: a cut can split a credential (#848). */
export function cutSnapshot(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(cutSnapshot);
	if (!v || typeof v !== "object") return v;
	return Object.fromEntries(
		Object.entries(v).map(([k, x]) => [
			k,
			LABEL_KEYS.has(k)
				? cutLabels(x)
				: k === "values" && Array.isArray(x)
					? x.map((p) =>
							Array.isArray(p) ? p.map((s) => cut(s, LIMITS.logLineChars)) : p,
						)
					: cutSnapshot(x),
		]),
	);
}
