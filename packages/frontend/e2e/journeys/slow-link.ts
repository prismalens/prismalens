// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CDPSession, Page } from "@playwright/test";

/**
 * The slow link every #1101 walk runs on (conditions table, "The slow link"): a phone
 * link's round trip and bandwidth, and a CPU slowed 4×, since a big page usually hangs on
 * main-thread work rather than bytes. Chromium only (CDP). Erasable types only: node runs it as is.
 */
export const SLOW_LINK = {
	/** Added to every request, as Chrome models a round trip. */
	latencyMs: 400,
	downKbps: 1600,
	upKbps: 750,
	cpuRate: 4,
} as const;

export interface Transfer {
	url: string;
	/** Bytes on the wire, compressed as sent. */
	bytes: number;
}

/** One request the page made, streams included: its bytes so far, compressed as sent. */
export interface RequestLog {
	url: string;
	method: string;
	/** When it was sent, epoch ms. */
	at: number;
	bytes: number;
	done: boolean;
	/** The response's `server-timing` header, when it sent one. */
	serverTiming?: string;
}

export interface SlowLinkHandle {
	readonly cdp: CDPSession;
	/** Takes the link offline for `ms`, then brings the slow link back. */
	drop(ms: number): Promise<void>;
	/** The longest main-thread task since the page loaded or the last `resetTasks`, in ms. */
	longestTask(): Promise<number>;
	/** The scripts behind the longest animation frame since load: what a long task was doing. */
	longestFrameScripts(): Promise<string[]>;
	resetTasks(): Promise<void>;
	/** Every response finished since `slowLink` or the last `resetTransfers`. */
	transfers(): Transfer[];
	resetTransfers(): void;
	/** Every request started since `slowLink` or the last `resetRequests`, open streams included. */
	requests(): RequestLog[];
	resetRequests(): void;
	/** Element count, open shadow roots included. */
	domNodes(): Promise<number>;
	off(): Promise<void>;
}

type Frame = { duration: number; scripts: string[] };
type Win = typeof globalThis & {
	__plLongTasks?: number[];
	__plFrames?: Frame[];
};

/** Starts the long-task log before any page script; call before `goto`. */
function watchLongTasks() {
	const w = globalThis as Win;
	w.__plLongTasks = [];
	try {
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) w.__plLongTasks?.push(e.duration);
		}).observe({ type: "longtask", buffered: true });
	} catch {
		// No long-task timing in this browser: longestTask reads 0.
	}
	w.__plFrames = [];
	try {
		new PerformanceObserver((list) => {
			for (const e of list.getEntries() as (PerformanceEntry & {
				scripts?: {
					duration: number;
					invoker: string;
					sourceURL: string;
					sourceFunctionName: string;
					sourceCharPosition: number;
				}[];
			})[])
				w.__plFrames?.push({
					duration: e.duration,
					// The entry's script list is frozen: sorting it in place threw a pageerror on every page (#1101).
					scripts: [...(e.scripts ?? [])]
						.sort((a, b) => b.duration - a.duration)
						.slice(0, 4)
						.map(
							(x) =>
								`${Math.round(x.duration)}ms ${x.invoker} ${x.sourceFunctionName || "?"} ${x.sourceURL.split("/").pop()}:${x.sourceCharPosition}`,
						),
				});
		}).observe({ type: "long-animation-frame", buffered: true });
	} catch {
		// No frame timing: longestFrameScripts reads none.
	}
}

export async function slowLink(
	page: Page,
	link: typeof SLOW_LINK = SLOW_LINK,
	/** False when a throttling proxy already shapes the link: only the CPU is slowed here. */
	network = true,
): Promise<SlowLinkHandle> {
	const cdp = await page.context().newCDPSession(page);
	const conditions = {
		offline: false,
		latency: link.latencyMs,
		downloadThroughput: (link.downKbps * 1000) / 8,
		uploadThroughput: (link.upKbps * 1000) / 8,
	};
	await cdp.send("Network.enable");
	if (network) await cdp.send("Network.emulateNetworkConditions", conditions);
	await cdp.send("Emulation.setCPUThrottlingRate", { rate: link.cpuRate });
	await page.addInitScript(watchLongTasks);
	const urls = new Map<string, string>();
	let done: Transfer[] = [];
	cdp.on("Network.responseReceived", (e) => {
		urls.set(e.requestId, e.response.url);
		const r = started.get(e.requestId);
		const timing = Object.entries(e.response.headers).find(
			([k]) => k.toLowerCase() === "server-timing",
		)?.[1];
		if (r && timing) r.serverTiming = timing;
	});
	let started = new Map<string, RequestLog>();
	cdp.on("Network.requestWillBeSent", (e) =>
		started.set(e.requestId, {
			url: e.request.url,
			method: e.request.method,
			at: Date.now(),
			bytes: 0,
			done: false,
		}),
	);
	cdp.on("Network.dataReceived", (e) => {
		const r = started.get(e.requestId);
		// A streamed body can report no wire bytes per chunk; its decoded length stands in.
		if (r) r.bytes += e.encodedDataLength || e.dataLength;
	});
	cdp.on("Network.loadingFinished", (e) => {
		done.push({ url: urls.get(e.requestId) ?? "", bytes: e.encodedDataLength });
		const r = started.get(e.requestId);
		if (r) Object.assign(r, { bytes: e.encodedDataLength, done: true });
	});
	return {
		cdp,
		drop: async (ms) => {
			await cdp.send("Network.emulateNetworkConditions", {
				...conditions,
				offline: true,
			});
			await new Promise((r) => setTimeout(r, ms));
			await cdp.send("Network.emulateNetworkConditions", conditions);
		},
		longestTask: () =>
			page.evaluate(() =>
				Math.max(0, ...((globalThis as Win).__plLongTasks ?? [])),
			),
		longestFrameScripts: () =>
			page.evaluate(
				() =>
					((globalThis as Win).__plFrames ?? []).reduce<Frame | null>(
						(top, f) => (!top || f.duration > top.duration ? f : top),
						null,
					)?.scripts ?? [],
			),
		resetTasks: () =>
			page.evaluate(() => {
				(globalThis as Win).__plLongTasks = [];
				(globalThis as Win).__plFrames = [];
			}),
		transfers: () => [...done],
		resetTransfers: () => {
			done = [];
		},
		requests: () => Array.from(started.values()).map((r) => ({ ...r })),
		resetRequests: () => {
			// Open streams stay in the log with their count zeroed, so later bytes still land.
			const open = Array.from(started).filter(([, r]) => !r.done);
			started = new Map(open.map(([id, r]) => [id, { ...r, bytes: 0 }]));
		},
		domNodes: () =>
			page.evaluate(() => {
				let n = 0;
				const walk = (root: Document | ShadowRoot) => {
					for (const el of Array.from(root.querySelectorAll("*"))) {
						n++;
						if (el.shadowRoot) walk(el.shadowRoot);
					}
				};
				walk(document);
				return n;
			}),
		off: async () => {
			await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
			await cdp.send("Network.emulateNetworkConditions", {
				offline: false,
				latency: 0,
				downloadThroughput: -1,
				uploadThroughput: -1,
			});
		},
	};
}
