// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LiveChange, LiveReset } from "@prismalens/contracts";
import { randomId } from "../random-id";

/** A claim to hold the browser's one change stream. */
export interface Token {
	claimedAt: number;
	tabId: string;
}

/** What the leader relays to the other tabs. */
export type Relay =
	| { kind: "frame"; change: LiveChange }
	| { kind: "reset"; change: LiveReset }
	| { kind: "beat"; cursor: string }
	| { kind: "status"; connected: boolean };

type Msg =
	| Relay
	| { kind: "leader"; token: Token; connected?: undefined }
	| { kind: "tab"; token: Token; connected: boolean; cursor?: string }
	| { kind: "bye"; token: Token }
	| { kind: "retry" };

const CHANNEL = "prismalens-live";
const HEARTBEAT_MS = 1_000;
const SILENT_MS = 5_000;
const START_MS = 1_500;

/**
 * The later claim wins, so a throttled old leader that wakes yields instead of flapping;
 * a tie goes to the higher tab id (#1181).
 */
export const outranks = (a: Token, b: Token): boolean =>
	a.claimedAt > b.claimedAt ||
	(a.claimedAt === b.claimedAt && a.tabId > b.tabId);

export interface LiveChannel {
	/** The leader shares what its stream heard; a follower's call does nothing. */
	relay(m: Relay): void;
	/** Asks the leader to reconnect now; the leader itself does. */
	retry(): void;
	stop(): void;
}

/**
 * One change stream per browser, elected over BroadcastChannel alone: Web Locks need a secure
 * context and Tailscale is often plain HTTP. Without BroadcastChannel each tab leads itself.
 */
export function joinLiveChannel(opts: {
	/** Holds the stream until `signal` aborts. */
	lead(signal: AbortSignal): void;
	/** A message the leader relayed. */
	follow(m: Relay): void;
	/** A follower asked the leader to reconnect now. */
	retry(): void;
	connected(): boolean;
	setConnected(up: boolean): void;
	/** The leader's place in the stream, so a follower that takes over resumes from it. */
	cursor(): string | undefined;
}): LiveChannel {
	if (typeof BroadcastChannel !== "function") {
		const own = new AbortController();
		opts.lead(own.signal);
		return { relay: () => {}, retry: opts.retry, stop: () => own.abort() };
	}
	const bc = new BroadcastChannel(CHANNEL);
	const tabId = randomId();
	let mine: Token | null = null;
	let leading: AbortController | null = null;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let wait: ReturnType<typeof setTimeout> | undefined;
	const post = (m: Msg) => bc.postMessage(m);

	const role = (r: "leader" | "follower") => {
		(globalThis as { __plLiveRole?: string }).__plLiveRole = r;
	};
	// A hidden tab's timers can fire a minute late: late means throttled, so wait one fresh window.
	const claimIn = (ms: number, late = true) => {
		clearTimeout(wait);
		const due = Date.now() + ms;
		wait = setTimeout(() => {
			if (late && Date.now() - due > HEARTBEAT_MS * 2) claimIn(ms, false);
			else claim();
		}, ms);
	};
	function claim() {
		mine = { claimedAt: Date.now(), tabId };
		role("leader");
		performance.mark("pl:live-leader");
		post({ kind: "leader", token: mine });
		const token = mine;
		heartbeat = setInterval(
			() =>
				post({
					kind: "tab",
					token,
					connected: opts.connected(),
					cursor: opts.cursor(),
				}),
			HEARTBEAT_MS,
		);
		leading = new AbortController();
		opts.lead(leading.signal);
	}
	function stepDown() {
		leading?.abort();
		leading = null;
		mine = null;
		clearInterval(heartbeat);
		role("follower");
	}

	bc.onmessage = (e: MessageEvent<Msg>) => {
		const m = e.data;
		if (m.kind === "retry") {
			if (mine) opts.retry();
			return;
		}
		if (m.kind === "leader" || m.kind === "tab") {
			if (mine) {
				if (!outranks(m.token, mine))
					return post({ kind: "leader", token: mine });
				stepDown();
			}
			if (m.connected !== undefined) opts.setConnected(m.connected);
			if (m.kind === "tab" && m.cursor)
				opts.follow({ kind: "beat", cursor: m.cursor });
			return claimIn(SILENT_MS + Math.random() * 1_000);
		}
		if (m.kind === "bye") {
			if (!mine) claimIn(Math.random() * 300, false);
			return;
		}
		if (!mine) opts.follow(m);
	};
	const bye = () => {
		if (mine) post({ kind: "bye", token: mine });
	};
	window.addEventListener("pagehide", bye);
	role("follower");
	claimIn(START_MS + Math.random() * 500);

	return {
		relay: (m) => {
			if (mine) post(m);
		},
		retry: () => (mine ? opts.retry() : post({ kind: "retry" })),
		stop: () => {
			bye();
			stepDown();
			clearTimeout(wait);
			window.removeEventListener("pagehide", bye);
			bc.close();
		},
	};
}
