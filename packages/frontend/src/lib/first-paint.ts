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
	/** Calls its content makes from those answers, never held; a final `*` matches any rest. */
	soon?: readonly string[];
	/** False: the HTML starts its calls, and nothing else waits for its first content. */
	hold?: false;
	/** Held calls the first screen still draws (header, picker): first in the lane after it. */
	next?: readonly string[];
}

/** Every signed-in page draws the device check and the sidebar's thread list. */
const SHELL_CALLS = ["/api/operator/whoami", "/api/threads/feed?cursor=0"];
const THREAD_CALLS = [
	...SHELL_CALLS,
	"/api/investigations/$1",
	"/api/investigations/$1/window?fold=true&$item",
];
/** The model picker's agents and default: it reads "…" until they land. */
const PICKER_CALLS = ["/api/settings/harnesses", "/api/settings/harness"];
/** The header's git and PR state and the details card: 10 s in, behind 25 reads, before #1130. */
const THREAD_NEXT = [
	"/api/threads/$1/context",
	"/api/threads/$1/pull-requests",
	"/api/investigations/$1/status",
	...PICKER_CALLS,
];

/** The first match wins: the diff before the thread it is a panel of. */
export const FIRST_PAINT: readonly FirstPaintPage[] = [
	{
		name: "home",
		path: /^\/(?:new)?(?:\?.*)?$/,
		calls: SHELL_CALLS,
		routeId: "/_authenticated/new",
		next: [
			...PICKER_CALLS,
			"/api/services?limit=100",
			"/api/repositories?limit=100",
		],
	},
	{
		name: "diff",
		path: /^\/threads\/([0-9a-f-]{36})\?(?:.*&)?panel=changes(?:&.*)?$/,
		calls: [
			...THREAD_CALLS,
			"/api/investigations/$1/changes?scope=all&patch=none",
		],
		// The open file's patch is the pane's content: it never queues behind held calls (#1130).
		soon: ["/api/investigations/$1/changes/patch?*"],
		next: THREAD_NEXT,
	},
	{
		name: "thread",
		path: /^\/threads\/([0-9a-f-]{36})(?:\?.*)?$/,
		calls: THREAD_CALLS,
		next: THREAD_NEXT,
	},
	// The device check otherwise waits behind the page's code: 4 s on the slow link (#1130).
	{
		name: "run",
		path: /^\/incidents\/([0-9a-f-]{36})\/conversation(?:\?.*)?$/,
		calls: [...SHELL_CALLS, "/api/incidents/$1"],
		hold: false,
	},
	{
		name: "settings",
		path: /^\/settings(?:\?.*)?$/,
		calls: SHELL_CALLS,
		hold: false,
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
let holding = false;
let landed: string | null = null;
let allowed: RegExp[] = [];
let first: RegExp[] = [];

/** The page a load landed on while its first content is pending ("home", "thread", "diff"), else null. */
export const firstContentOf = (): string | null => (holding ? landed : null);
const waiting: (() => void)[] = [];

/**
 * Loads share the link through one lane (#1130): a browser opens six connections per host,
 * and the lane takes at most four, so the open page's own call (a file's patch, a click's
 * answer) always finds one free. Code a mounted part draws goes first; held calls, then code
 * for later, take two at most, so their answers land spread out, not in one long render.
 */
const LANE_IN_FLIGHT = 4;
const LATER_IN_FLIGHT = 2;
export type LaneClass = "soon" | "call" | "later";
type Turn = { kind: LaneClass; go: () => void };
const lane: Turn[] = [];
let busy = 0;
let busyLater = 0;
const pump = () => {
	while (busy < LANE_IN_FLIGHT) {
		const next =
			lane.find((t) => t.kind === "soon") ??
			(busyLater < LATER_IN_FLIGHT
				? (lane.find((t) => t.kind === "call") ??
					lane.find((t) => t.kind === "later"))
				: undefined);
		if (!next) return;
		lane.splice(lane.indexOf(next), 1);
		next.go();
	}
};

/**
 * Lane turns start in a task of their own: a mount's effects queue a dozen loads, and each
 * import's preload links cost the render's long task 50 ms on a slowed CPU (#1130).
 */
const starting: (() => void)[] = [];
const startApart = (run: () => void) => {
	if (starting.push(run) === 1)
		setTimeout(() => {
			for (const go of starting.splice(0)) go();
		}, 0);
};

/** Starts `start` in the lane, in its class; `now` starts a queued one at once. */
export function later<T>(
	start: () => Promise<T>,
	kind: LaneClass = "later",
): {
	done: Promise<T>;
	now: () => void;
} {
	let begun = false;
	let ok: (v: T) => void = () => {};
	let fail: (e: unknown) => void = () => {};
	const done = new Promise<T>((resolve, reject) => {
		ok = resolve;
		fail = reject;
	});
	const begin = (slot: boolean) => {
		if (begun) return;
		begun = true;
		const counted = slot && kind !== "soon";
		if (slot) busy++;
		if (counted) busyLater++;
		const run = () =>
			new Promise<T>((r) => r(start())).then(ok, fail).finally(() => {
				if (slot) busy--;
				if (counted) busyLater--;
				if (slot) pump();
			});
		if (slot) startApart(run);
		else run();
	};
	const turn: Turn = { kind, go: () => begin(true) };
	lane.push(turn);
	pump();
	return {
		done,
		now: () => {
			const i = lane.indexOf(turn);
			if (i < 0) return;
			lane.splice(i, 1);
			begin(false);
		},
	};
}

/** Called once at startup with the landing path and query: holds the calls its first paint does not need. */
export function holdForFirstPaint(at: string): void {
	const page = landingPage(at);
	if (!page || holding || page.hold === false) return;
	landed = page.name;
	const match = (c: string) =>
		new RegExp(
			`^${c
				.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
				.replace("\\$1", "[^/?]+")
				.replace("\\$item", "[^&]+")
				.replace(/\\\*$/, ".*")}$`,
		);
	allowed = [...page.calls, ...(page.soon ?? [])].map(match);
	first = (page.next ?? []).map(match);
	holding = true;
	setTimeout(releaseHeld, HOLD_MAX_MS);
}

/** True until the landing page has painted its first content. */
export const firstContentPending = () => holding;

const afterFirst: (() => void)[] = [];
/** Runs `fn` once the page has painted its first content, or now if it has. */
export function onFirstContent(fn: () => void): void {
	if (holding) afterFirst.push(fn);
	else fn();
}

function releaseHeld(): void {
	if (!holding) return;
	holding = false;
	allowed = [];
	first = [];
	for (const fn of afterFirst.splice(0)) fn();
	for (const go of waiting.splice(0)) go();
}

/** The page painted its first content: held calls go out, after that paint. */
export function markFirstContent(): void {
	if (!holding) return;
	requestAnimationFrame(() => setTimeout(releaseHeld, 0));
}

/**
 * Runs `run` now, or, for a call the first paint does not need, once the page has painted
 * and then in the later lane, so the answers arrive spread out rather than in one render.
 */
export function afterFirstPaint<T>(
	pathAndQuery: string,
	run: () => Promise<T>,
): Promise<T> {
	if (!holding || allowed.some((a) => a.test(pathAndQuery))) return run();
	return new Promise<T>((ok, fail) => {
		// The change stream goes first and takes no lane: until it opens, a dropped link reads as connecting.
		if (pathAndQuery.startsWith("/api/live/"))
			waiting.unshift(() => void run().then(ok, fail));
		else {
			const kind = first.some((a) => a.test(pathAndQuery)) ? "soon" : "call";
			waiting.push(() => void later(run, kind).done.then(ok, fail));
		}
	});
}
