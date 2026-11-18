// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LiveChange } from "@prismalens/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	joinLiveChannel,
	outranks,
	type Relay,
	type Token,
} from "./live-channel";

class FakeBroadcastChannel {
	static channels = new Map<string, Set<FakeBroadcastChannel>>();
	name: string;
	onmessage: ((event: MessageEvent) => void) | null = null;
	closed = false;

	constructor(name: string) {
		this.name = name;
		let set = FakeBroadcastChannel.channels.get(name);
		if (!set) {
			set = new Set();
			FakeBroadcastChannel.channels.set(name, set);
		}
		set.add(this);
	}

	postMessage(data: unknown) {
		if (this.closed) return;
		const set = FakeBroadcastChannel.channels.get(this.name);
		if (!set) return;
		// As a browser does, the recipients are the channels open when the message is posted.
		const to = Array.from(set);
		setTimeout(() => {
			if (this.closed) return;
			for (const ch of to) {
				if (ch !== this && !ch.closed) {
					ch.onmessage?.(new MessageEvent("message", { data }));
				}
			}
		}, 1);
	}

	close() {
		this.closed = true;
		const set = FakeBroadcastChannel.channels.get(this.name);
		set?.delete(this);
	}
}

describe("live channel and election (#1181)", () => {
	const originalBC = globalThis.BroadcastChannel;

	beforeEach(() => {
		FakeBroadcastChannel.channels.clear();
		(globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
			FakeBroadcastChannel;
		vi.useFakeTimers();
	});

	afterEach(() => {
		(globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
			originalBC;
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("outranks: later claim wins; tie goes to higher tabId", () => {
		const a: Token = { claimedAt: 200, tabId: "tab-1" };
		const b: Token = { claimedAt: 100, tabId: "tab-9" };
		expect(outranks(a, b)).toBe(true);
		expect(outranks(b, a)).toBe(false);

		// Tie in claimedAt -> higher tabId wins
		const c1: Token = { claimedAt: 100, tabId: "tab-b" };
		const c2: Token = { claimedAt: 100, tabId: "tab-a" };
		expect(outranks(c1, c2)).toBe(true);
		expect(outranks(c2, c1)).toBe(false);
	});

	it("one tab alone claims after start-up wait (1.5–2 s) and calls lead", async () => {
		let leadCalled = false;
		const channel = joinLiveChannel({
			lead: () => {
				leadCalled = true;
			},
			follow: () => {},
			retry: () => {},
			connected: () => true,
			setConnected: () => {},
			cursor: () => undefined,
		});

		// Before startup window (1.5s), lead has not been called
		await vi.advanceTimersByTimeAsync(1400);
		expect(leadCalled).toBe(false);

		// By 2.0s (1500ms + max 500ms jitter), lead is called
		await vi.advanceTimersByTimeAsync(600);
		expect(leadCalled).toBe(true);

		channel.stop();
	});

	it("two tabs claiming at the same instant end with exactly one leader", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0);

		let tab1Signal: AbortSignal | null = null;
		let tab2Signal: AbortSignal | null = null;

		const ch1 = joinLiveChannel({
			lead: (signal) => {
				tab1Signal = signal;
			},
			follow: () => {},
			retry: () => {},
			connected: () => true,
			setConnected: () => {},
			cursor: () => undefined,
		});

		const ch2 = joinLiveChannel({
			lead: (signal) => {
				tab2Signal = signal;
			},
			follow: () => {},
			retry: () => {},
			connected: () => true,
			setConnected: () => {},
			cursor: () => undefined,
		});

		// Both claim at 1500ms and post claims (delivered at 1501ms)
		await vi.advanceTimersByTimeAsync(1500);

		expect(tab1Signal).not.toBeNull();
		expect(tab2Signal).not.toBeNull();
		if (!tab1Signal || !tab2Signal) throw new Error("Signals not initialized");

		// Deliver the cross-posted leader claims
		await vi.advanceTimersByTimeAsync(10);

		// Exactly one of the two lead signals was aborted by stepDown
		const sig1 = tab1Signal as AbortSignal;
		const sig2 = tab2Signal as AbortSignal;
		const abortedCount = (sig1.aborted ? 1 : 0) + (sig2.aborted ? 1 : 0);
		expect(abortedCount).toBe(1);

		ch1.stop();
		ch2.stop();
	});

	it("a leader that receives a lower-ranked leader message re-posts and stays leader", async () => {
		let leaderSignal: AbortSignal | null = null;
		const peerBC = new FakeBroadcastChannel("prismalens-live");
		let repostedMessage: unknown = null;
		peerBC.onmessage = (e) => {
			repostedMessage = e.data;
		};

		const ch = joinLiveChannel({
			lead: (signal) => {
				leaderSignal = signal;
			},
			follow: () => {},
			retry: () => {},
			connected: () => true,
			setConnected: () => {},
			cursor: () => undefined,
		});

		// Advance past startup to claim leadership
		await vi.advanceTimersByTimeAsync(2000);
		expect(leaderSignal).not.toBeNull();
		if (!leaderSignal) throw new Error("Leader signal not set");
		expect((leaderSignal as AbortSignal).aborted).toBe(false);

		// Fake peer posts a lower-ranked claim
		peerBC.postMessage({
			kind: "leader",
			token: { claimedAt: 0, tabId: "00000000-0000-0000-0000-000000000000" },
		});
		await vi.advanceTimersByTimeAsync(10);

		// Leader stays leader and re-posts its claim
		expect((leaderSignal as AbortSignal).aborted).toBe(false);
		expect(repostedMessage).toMatchObject({ kind: "leader" });

		ch.stop();
		peerBC.close();
	});

	it("a follower claims after 5–6 s without a heartbeat; heartbeats every 1 s keep it a follower", async () => {
		let followerLeadCalled = false;
		const peerBC = new FakeBroadcastChannel("prismalens-live");

		const ch = joinLiveChannel({
			lead: () => {
				followerLeadCalled = true;
			},
			follow: () => {},
			retry: () => {},
			connected: () => true,
			setConnected: () => {},
			cursor: () => undefined,
		});

		const leaderToken: Token = { claimedAt: Date.now() + 10_000, tabId: "peer-leader" };

		// First message establishes peer as leader before startup timer expires
		peerBC.postMessage({ kind: "leader", token: leaderToken });
		await vi.advanceTimersByTimeAsync(500);
		expect(followerLeadCalled).toBe(false);

		// Heartbeats every 1s keep it as a follower for 10s
		for (let i = 0; i < 10; i++) {
			await vi.advanceTimersByTimeAsync(1000);
			peerBC.postMessage({
				kind: "tab",
				token: leaderToken,
				connected: true,
			});
		}
		expect(followerLeadCalled).toBe(false);

		// Heartbeats stop -> after 6s (SILENT_MS 5000 + max 1000 jitter), follower claims
		await vi.advanceTimersByTimeAsync(6000);
		expect(followerLeadCalled).toBe(true);

		ch.stop();
		peerBC.close();
	});

	it("a claim timer firing more than 2 s late waits one more window before claiming", async () => {
		let leadCalled = false;
		const ch = joinLiveChannel({
			lead: () => {
				leadCalled = true;
			},
			follow: () => {},
			retry: () => {},
			connected: () => true,
			setConnected: () => {},
			cursor: () => undefined,
		});

		// Jump system time ahead by 4500ms so when timer fires, Date.now() - due > 2000
		vi.setSystemTime(Date.now() + 2500);
		await vi.advanceTimersByTimeAsync(2000);

		// Timer fired late -> reset for one more window, lead not called yet
		expect(leadCalled).toBe(false);

		// Advance one full window (2000ms) on time -> now it claims
		await vi.advanceTimersByTimeAsync(2000);
		expect(leadCalled).toBe(true);

		ch.stop();
	});

	it("bye from the leader causes a follower to claim within 300 ms", async () => {
		let followerLead = false;
		const peerBC = new FakeBroadcastChannel("prismalens-live");

		const ch = joinLiveChannel({
			lead: () => {
				followerLead = true;
			},
			follow: () => {},
			retry: () => {},
			connected: () => true,
			setConnected: () => {},
			cursor: () => undefined,
		});

		const leaderToken: Token = { claimedAt: Date.now() + 10_000, tabId: "peer-lead" };
		peerBC.postMessage({ kind: "leader", token: leaderToken });
		await vi.advanceTimersByTimeAsync(50);

		// Follower gets bye from leader
		peerBC.postMessage({ kind: "bye", token: leaderToken });

		// Claims within 300 ms
		await vi.advanceTimersByTimeAsync(300);
		expect(followerLead).toBe(true);

		ch.stop();
		peerBC.close();
	});

	it("relay: frames posted by leader reach follower follow; tab heartbeat with cursor reaches follow as beat", async () => {
		const followed: Relay[] = [];

		// Leader tab claims first
		const chLeader = joinLiveChannel({
			lead: () => {},
			follow: () => {},
			retry: () => {},
			connected: () => true,
			setConnected: () => {},
			cursor: () => "epoch.42",
		});

		// Advance past startup so chLeader claims
		await vi.advanceTimersByTimeAsync(2000);

		// Follower starts and hears leader
		const chFollower = joinLiveChannel({
			lead: () => {},
			follow: (m) => followed.push(m),
			retry: () => {},
			connected: () => false,
			setConnected: () => {},
			cursor: () => undefined,
		});

		// Let follower hear the leader's heartbeat
		await vi.advanceTimersByTimeAsync(1000);

		// Leader relays a frame
		const frameChange: LiveChange = { cursor: "ep.1", topics: ["incidents"] };
		chLeader.relay({ kind: "frame", change: frameChange });
		await vi.advanceTimersByTimeAsync(10);
		expect(followed).toContainEqual({ kind: "frame", change: frameChange });

		// Heartbeat sends cursor which reaches follower as a beat
		await vi.advanceTimersByTimeAsync(1000);
		expect(followed).toContainEqual({ kind: "beat", cursor: "epoch.42" });

		chLeader.stop();
		chFollower.stop();
	});

	it("without BroadcastChannel, the tab leads at once", () => {
		(globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
			undefined;

		let leadSignal: AbortSignal | null = null;
		const ch = joinLiveChannel({
			lead: (signal) => {
				leadSignal = signal;
			},
			follow: () => {},
			retry: () => {},
			connected: () => true,
			setConnected: () => {},
			cursor: () => undefined,
		});

		// Immediately / synchronously leads
		expect(leadSignal).not.toBeNull();
		if (!leadSignal) throw new Error("Lead signal not set");
		expect((leadSignal as AbortSignal).aborted).toBe(false);

		ch.stop();
		expect((leadSignal as AbortSignal).aborted).toBe(true);
	});
});
