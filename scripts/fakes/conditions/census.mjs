// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The request census behind net.slow-link's live rows (#1181): what a page asks the API for while
// it loads, while it idles, and while another thread's agent works; how stale its thread list gets;
// and whether a fresh tab still loads beside several live ones. slow-link-measure.mjs drives it.

/** @typedef {import("../../../packages/frontend/e2e/journeys/slow-link.ts").RequestLog} RequestLog */

const isApi = (/** @type {{ url: string }} */ r) =>
	new URL(r.url).pathname.startsWith("/api/");
const isStream = (/** @type {{ url: string }} */ r) =>
	/\/(stream|live\/changes)$/.test(new URL(r.url).pathname);

/** A request's route with ids folded, so one call per thread reads as one route. */
export const route = (/** @type {{ url: string, method: string }} */ r) => {
	const path = new URL(r.url).pathname
		.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}|\b[a-z0-9]{20,}\b/gi, ":id")
		.replace(/\/\d+(?=\/|$)/g, "/:n");
	return `${r.method} ${path}`;
};

/** What a page asked for over `ms`: requests per minute by route, and API and stream bytes. */
export function census(
	/** @type {RequestLog[]} */ log,
	/** @type {number} */ ms,
) {
	const api = log.filter(isApi);
	const perMin = (/** @type {number} */ n) => Math.round((n * 60_000) / ms);
	/** @type {Record<string, { n: number, bytes: number }>} */
	const byRoute = {};
	for (const r of api) {
		const k = route(r);
		byRoute[k] ??= { n: 0, bytes: 0 };
		byRoute[k].n++;
		byRoute[k].bytes += r.bytes;
	}
	const fetched = api.filter((r) => !isStream(r));
	return {
		requestsPerMin: perMin(fetched.length),
		apiBytesPerMin: perMin(fetched.reduce((n, r) => n + r.bytes, 0)),
		streamBytesPerMin: perMin(
			api.filter(isStream).reduce((n, r) => n + r.bytes, 0),
		),
		openStreams: api.filter((r) => isStream(r) && !r.done).length,
		routes: Object.fromEntries(
			Object.entries(byRoute)
				.sort((a, b) => b[1].n - a[1].n)
				.map(([k, v]) => [k, { perMin: perMin(v.n), bytes: v.bytes }]),
		),
	};
}

/** Every API call from navigation until now, and the URLs asked more than once. */
export function loadCensus(
	/** @type {RequestLog[]} */ log,
	/** @type {string} */ ui,
) {
	const api = log.filter(isApi);
	/** @type {Map<string, number>} */
	const seen = new Map();
	for (const r of api) {
		const k = `${r.method} ${r.url.replace(ui, "")}`;
		seen.set(k, (seen.get(k) ?? 0) + 1);
	}
	const dup = [...seen].filter(([, n]) => n > 1);
	return {
		requests: api.length,
		apiBytes: api.reduce((n, r) => n + r.bytes, 0),
		duplicateFetches: dup.reduce((n, [, c]) => n + c - 1, 0),
		duplicates: dup.map(([k, n]) => `${n}x ${k}`),
	};
}

/** The routes every tab re-reads on a hint, which the server may share across tabs (#1181). */
const SHARED =
	/^\/api\/(threads\/(feed|asks|statuses|[^/]+\/(context|pull-requests|links))|investigations\/[^/]+)$/;

/** Shared reads the server computed (`server-timing` miss) per minute, and misses over all answered. */
export function sharedComputes(
	/** @type {RequestLog[][]} */ logs,
	/** @type {number} */ ms,
) {
	const timed = logs
		.flat()
		.filter((r) => SHARED.test(new URL(r.url).pathname) && r.serverTiming);
	const misses = timed.filter((r) => /miss/.test(r.serverTiming ?? "")).length;
	return {
		// No timing header at all: a server without shared reads, untested rather than zero.
		perMin: timed.length ? Math.round((misses * 60_000) / ms) : null,
		missShare: timed.length
			? Math.round((misses / timed.length) * 100) / 100
			: null,
	};
}

/** Every open stream across the logs, transcripts included: what counts against 6 per host. */
export const longLived = (/** @type {RequestLog[][]} */ logs) =>
	logs.flat().filter((r) => isApi(r) && isStream(r) && !r.done).length;

/**
 * Samples, every 250 ms until `ms` passes, how far behind now the row of thread `id` reads
 * (its `data-activity`, epoch ms). The agent writes ten events a second, so the gap is the list's staleness.
 * @param {import("@playwright/test").Page} page
 */
export async function listLag(
	page,
	/** @type {string} */ id,
	/** @type {number} */ ms,
	/** When the thread started: a list that never shows its row is that stale. */
	/** @type {number} */ since,
) {
	const sel = `[data-testid=thread-row][data-id="${id}"]`;
	/** @type {number[]} */
	const lags = [];
	let missing = 0;
	const end = Date.now() + ms;
	let shown = null;
	let stalled = 0;
	while (Date.now() < end) {
		// A page whose main thread is busy answers late; what it last showed is what the person sees.
		const read = await Promise.race([
			page
				.evaluate(
					(s) =>
						document.querySelector(s)?.getAttribute("data-activity") ?? null,
					sel,
				)
				.catch(() => null),
			new Promise((r) => setTimeout(() => r(STALLED), 2000)),
		]);
		if (read === STALLED) stalled++;
		else shown = read;
		lags.push(
			Date.now() -
				(shown === null ? since : Number(shown) || Date.parse(shown)),
		);
		if (shown === null) missing++;
		await new Promise((r) => setTimeout(r, 250));
	}
	const sorted = [...lags].sort((a, b) => a - b);
	return {
		p95: Math.round(
			sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ??
				0,
		),
		max: Math.round(sorted.at(-1) ?? 0),
		samples: sorted.length,
		missing,
		stalled,
	};
}

const STALLED = Symbol("stalled");

/** An init script: the page reads as hidden once `globalThis.__plHide()` runs, as a background tab does. */
export function hideable() {
	let hidden = false;
	Object.defineProperty(document, "visibilityState", {
		get: () => (hidden ? "hidden" : "visible"),
	});
	Object.defineProperty(document, "hidden", { get: () => hidden });
	globalThis.__plHide = () => {
		hidden = true;
		document.dispatchEvent(new Event("visibilitychange"));
	};
}
