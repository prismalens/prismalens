// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { STREAM_SILENT_MS } from "@prismalens/contracts";

/** How long a stream may take to answer at all; a dead link accepts a request and never replies. */
export const CONNECT_TIMEOUT_MS = 10_000;
const TICK_MS = 250;

export interface SilenceWatch {
	/** A frame arrived: the stream is alive. */
	beat(): void;
	/** The stream is open: from now on silence past `STREAM_SILENT_MS` counts it down. */
	open(): void;
	stop(): void;
}

/**
 * Calls `onSilent` once a stream goes quiet past its limit: `CONNECT_TIMEOUT_MS` until it
 * opens, then `STREAM_SILENT_MS` (#1101 category 12). A tick that runs late means the page
 * was busy or hidden, not that the link died, so the stream gets a fresh window.
 */
export function watchSilence(onSilent: () => void): SilenceWatch {
	let limit = CONNECT_TIMEOUT_MS;
	let last = performance.now();
	let tick = last;
	let fired = false;
	const timer = setInterval(() => {
		const now = performance.now();
		if (now - tick > TICK_MS * 4) last = now;
		tick = now;
		if (!fired && now - last > limit) {
			fired = true;
			clearInterval(timer);
			onSilent();
		}
	}, TICK_MS);
	return {
		beat: () => {
			last = performance.now();
		},
		open: () => {
			limit = STREAM_SILENT_MS;
			last = performance.now();
		},
		stop: () => clearInterval(timer),
	};
}

/** Calls `onOffline` when the device says it lost the network; returns the unsubscribe. */
export function onDeviceOffline(onOffline: () => void): () => void {
	if (typeof window === "undefined") return () => {};
	window.addEventListener("offline", onOffline);
	return () => window.removeEventListener("offline", onOffline);
}
