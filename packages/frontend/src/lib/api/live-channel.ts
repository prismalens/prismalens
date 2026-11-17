// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LiveChange, LiveReset } from "@prismalens/contracts";

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
	| { kind: "tab"; token: Token; connected: boolean }
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

const newTabId = (): string =>
	typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: Math.random().toString(16).slice(2) + Date.now().toString(16);

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
}): LiveChannel {
	if (typeof BroadcastChannel !== "function") {
		const own = new AbortController();
		opts.lead(own.signal);
		return { relay: () => {}, retry: opts.retry, stop: () => own.abort() };
	}
	const bc = new BroadcastChannel(CHANNEL);
	const tabId = newTabId();
	let mine: Token | null = null;
	let leading: AbortController | null = null;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let wait: ReturnType<typeof setTimeout> | undefined;
	const post = (m: Msg) => bc.postMessage(m);

	const claimIn = (ms: number) => {
		clearTimeout(wait);
		wait = setTimeout(claim, ms);
	};
	function claim() {
		mine = { claimedAt: Date.now(), tabId };
		performance.mark("pl:live-leader");
		post({ kind: "leader", token: mine });
		const token = mine;
		heartbeat = setInterval(
			() => post({ kind: "tab", token, connected: opts.connected() }),
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
			return claimIn(SILENT_MS + Math.random() * 1_000);
		}
		if (m.kind === "bye") {
			if (!mine) claimIn(Math.random() * 300);
			return;
		}
		if (!mine) opts.follow(m);
	};
	const bye = () => {
		if (mine) post({ kind: "bye", token: mine });
	};
	window.addEventListener("pagehide", bye);
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
