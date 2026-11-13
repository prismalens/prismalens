// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What each landing page's first paint needs from the API, in one place (#1101 category 12).
 * The HTML's head script fetches these as the page parses (`EARLY_FETCH_SCRIPT`), the API
 * client takes those responses by URL, and every other call waits until the page has painted
 * its first content: on a 400 ms link a dozen calls at once queue behind each other and the code.
 */
export interface FirstPaintPage {
	name: string;
	/** The landing path and query; `$1` in a call is its first group. */
	path: RegExp;
	/** GET paths and queries, exactly as the API client builds them. `$item` is the thread's landing. */
	calls: readonly string[];
	/** The route whose code the router starts at once, when the path redirects to it. */
	routeId?: string;
}

/** Every signed-in page draws the device check and the sidebar's thread list. */
const SHELL_CALLS = ["/api/operator/whoami", "/api/threads/feed?cursor=0"];
const THREAD_CALLS = [
	...SHELL_CALLS,
	"/api/investigations/$1",
	"/api/investigations/$1/window?fold=true&$item",
];

/** The first match wins: the diff before the thread it is a panel of. */
export const FIRST_PAINT: readonly FirstPaintPage[] = [
	{
		name: "home",
		path: /^\/(?:new)?(?:\?.*)?$/,
		calls: SHELL_CALLS,
		routeId: "/_authenticated/new",
	},
	{
		name: "diff",
		path: /^\/threads\/([0-9a-f-]{36})\?(?:.*&)?panel=changes(?:&.*)?$/,
		calls: [
			...THREAD_CALLS,
			"/api/investigations/$1/changes?scope=all&patch=none",
		],
	},
	{
		name: "thread",
		path: /^\/threads\/([0-9a-f-]{36})(?:\?.*)?$/,
		calls: THREAD_CALLS,
	},
];

/** The page a load landed on (path and query), if it is one listed. */
export function landingPage(at: string): FirstPaintPage | undefined {
	return FIRST_PAINT.find((p) => p.path.test(at));
}

/**
 * Runs before any module, from the HTML: fetches the landing page's calls and leaves the
 * responses on `window.__plEarly` for the API client. `$item` is `at=<key>` for an
 * `#item-<key>` link, else `position=unread`, as `thread-landing.ts` opens the window.
 */
export const EARLY_FETCH_SCRIPT = `(function(){try{
var P=${JSON.stringify(FIRST_PAINT.map((p) => [p.path.source, p.calls]))};
var path=location.pathname+location.search,m=null,calls=null;
for(var i=0;i<P.length&&!m;i++){m=new RegExp(P[i][0]).exec(path);if(m)calls=P[i][1];}
if(!m)return;
var h=/^#item-(.+)$/.exec(location.hash),item=h?'at='+encodeURIComponent(decodeURIComponent(h[1])):'position=unread';
var e={};for(var j=0;j<calls.length;j++){var u=calls[j].replace('$1',m[1]||'').replace('$item',item);
e[u]=fetch(u,{credentials:'include',headers:{'Content-Type':'application/json'}});e[u].catch(function(){});}
window.__plEarly={at:Date.now(),res:e};}catch(_){}})();`;

type EarlyWindow = Window & {
	__plEarly?: { at: number; res: Record<string, Promise<Response>> } | null;
};

/** A response the HTML started for this GET, once; past this age it is asked for again. */
const EARLY_FRESH_MS = 30_000;
export function takeEarly(pathAndQuery: string): Promise<Response> | null {
	if (typeof window === "undefined") return null;
	const early = (window as EarlyWindow).__plEarly;
	const res = early?.res[pathAndQuery];
	if (!early || !res) return null;
	delete early.res[pathAndQuery];
	return Date.now() - early.at < EARLY_FRESH_MS ? res : null;
}

/** The first paint gets the link to itself until this, at most. */
const HOLD_MAX_MS = 8_000;
/** Held calls go out a few at a time, so their answers do not all render in one task. */
const RELEASE_BATCH = 3;
const RELEASE_GAP_MS = 150;
let holding = false;
let allowed: RegExp[] = [];
const waiting: (() => void)[] = [];

/** Called once at startup with the landing path and query: holds the calls its first paint does not need. */
export function holdForFirstPaint(at: string): void {
	const page = landingPage(at);
	if (!page || holding) return;
	allowed = page.calls.map(
		(c) =>
			new RegExp(
				`^${c
					.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
					.replace("\\$1", "[^/?]+")
					.replace("\\$item", "[^&]+")}$`,
			),
	);
	holding = true;
	setTimeout(releaseHeld, HOLD_MAX_MS);
}

function releaseHeld(): void {
	if (!holding) return;
	holding = false;
	allowed = [];
	const next = () => {
		for (const go of waiting.splice(0, RELEASE_BATCH)) go();
		if (waiting.length) setTimeout(next, RELEASE_GAP_MS);
	};
	next();
}

/** The page painted its first content: held calls go out, after that paint. */
export function markFirstContent(): void {
	if (!holding) return;
	requestAnimationFrame(() => setTimeout(releaseHeld, 0));
}

/** Waits, before the first content, for a call that first paint does not need; else returns at once. */
export function firstPaintTurn(pathAndQuery: string): Promise<void> | null {
	if (!holding || allowed.some((a) => a.test(pathAndQuery))) return null;
	return new Promise<void>((go) => {
		waiting.push(go);
	});
}
