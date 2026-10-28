// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The run panel's browser (#973), desktop only: a WebContentsView beside the
 * app, never inside it. It shares nothing with the app: its own in-memory
 * session (no device cookie), no preload, no Node, sandboxed. Destinations
 * follow T3 Code and Traycer: http and https anywhere, nothing else.
 */

import type { WebPreferences } from "electron";

export const BROWSER_CHANNEL = {
	open: "prismalens:browser:open",
	bounds: "prismalens:browser:bounds",
	go: "prismalens:browser:go",
	state: "prismalens:browser:state",
} as const;

/** No `persist:` prefix: the session lives in memory and dies with the app. */
export const BROWSER_PARTITION = "pl-browser";

export function browserWebPreferences(packaged: boolean): WebPreferences {
	return {
		partition: BROWSER_PARTITION,
		sandbox: true,
		contextIsolation: true,
		nodeIntegration: false,
		nodeIntegrationInSubFrames: false,
		nodeIntegrationInWorker: false,
		webviewTag: false,
		webSecurity: true,
		allowRunningInsecureContent: false,
		devTools: !packaged,
		spellcheck: false,
		// A page cannot raise alert, confirm or prompt in the app's name (#977 OBJ-010).
		disableDialogs: true,
	};
}

/** The URL to load, or null: http(s) only, no credentials in it, a bare host read as https. */
export function browserUrl(raw: string): URL | null {
	const text = raw.trim();
	if (!text) return null;
	// `localhost:3000` is a host and port, not a scheme; a typed loopback address is http, as in T3 Code (#977 OBJ-014).
	const scheme =
		/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ||
		/^(javascript|data|about|blob|view-source|mailto|file|chrome|devtools):/i.test(
			text,
		);
	const loopback =
		/^(localhost|127(\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(
			text,
		);
	const withScheme = scheme ? text : `${loopback ? "http" : "https"}://${text}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	if (url.username || url.password || !url.hostname) return null;
	return url;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** The view's bounds from the renderer, as whole pixels inside the window; null for anything else. */
export function clampBounds(
	rect: unknown,
	size: { width: number; height: number },
): Rect | null {
	if (!rect || typeof rect !== "object") return null;
	const r = rect as Record<string, unknown>;
	const nums = [r.x, r.y, r.width, r.height];
	if (!nums.every((n) => typeof n === "number" && Number.isFinite(n)))
		return null;
	const [x, y, w, h] = (nums as number[]).map(Math.round) as [
		number,
		number,
		number,
		number,
	];
	if (x < 0 || y < 0 || x >= size.width || y >= size.height) return null;
	const width = Math.min(w, size.width - x);
	const height = Math.min(h, size.height - y);
	return width > 0 && height > 0 ? { x, y, width, height } : null;
}

export function isAppOrigin(url: string, base: string): boolean {
	try {
		return new URL(url).origin === new URL(base).origin;
	} catch {
		return false;
	}
}

/**
 * Only the app's own top frame in the app window may drive the browser:
 * a page that navigated the window elsewhere, or a frame inside it, may not.
 */
export function trustedSender(
	event: {
		sender: unknown;
		senderFrame?: { url: string; parent: unknown } | null;
	},
	appContents: unknown,
	base: string,
): boolean {
	const frame = event.senderFrame;
	return (
		event.sender === appContents &&
		!!frame &&
		frame.parent === null &&
		isAppOrigin(frame.url, base)
	);
}

export type BrowserGo =
	| "back"
	| "forward"
	| "reload"
	| "external"
	| "state"
	| "clear";

export function isGo(v: unknown): v is BrowserGo {
	return (
		v === "back" ||
		v === "forward" ||
		v === "reload" ||
		v === "external" ||
		v === "state" ||
		v === "clear"
	);
}
