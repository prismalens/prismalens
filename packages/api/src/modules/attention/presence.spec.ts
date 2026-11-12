// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { PresenceLeases } from "./presence.js";

describe("presence (#1101 category 4)", () => {
	it("a held lease lists its device as a viewer of that thread only", () => {
		const leases = new PresenceLeases(60_000);
		const now = 1_000_000;
		leases.hold("dev-1", "thread-a", now);

		expect(leases.viewers("thread-a", now)).toEqual(["dev-1"]);
		expect(leases.viewers("thread-b", now)).toEqual([]);
	});

	it("after the TTL it lists none", () => {
		const leases = new PresenceLeases(60_000);
		const now = 1_000_000;
		leases.hold("dev-1", "thread-a", now);

		expect(leases.viewers("thread-a", now + 60_000)).toEqual([]);
		expect(leases.holders(now + 60_000)).toEqual([]);
	});

	it("drop removes it", () => {
		const leases = new PresenceLeases(60_000);
		const now = 1_000_000;
		leases.hold("dev-1", "thread-a", now);
		leases.drop("dev-1");

		expect(leases.viewers("thread-a", now)).toEqual([]);
		expect(leases.holders(now)).toEqual([]);
	});

	it("a revoked device id in the set is left out", () => {
		const leases = new PresenceLeases(60_000);
		const now = 1_000_000;
		leases.hold("dev-1", "thread-a", now);
		leases.hold("dev-2", "thread-a", now);

		const revoked = new Set(["dev-1"]);
		expect(leases.viewers("thread-a", now, revoked)).toEqual(["dev-2"]);
	});

	it("a lease on threadId null views no thread but appears in holders", () => {
		const leases = new PresenceLeases(60_000);
		const now = 1_000_000;
		leases.hold("dev-1", null, now);

		expect(leases.viewers("thread-a", now)).toEqual([]);
		expect(leases.holders(now)).toEqual(["dev-1"]);
	});

	it("renewing moves expiry", () => {
		const leases = new PresenceLeases(60_000);
		const now = 1_000_000;
		leases.hold("dev-1", "thread-a", now);

		// Renew at now + 50_000 with a new TTL window
		leases.hold("dev-1", "thread-a", now + 50_000);

		// At now + 60_000 (past original expiry of 1_060_000), it's still alive (new expiry is 1_110_000)
		expect(leases.viewers("thread-a", now + 60_000)).toEqual(["dev-1"]);
		expect(leases.holders(now + 60_000)).toEqual(["dev-1"]);

		// Past new expiry
		expect(leases.viewers("thread-a", now + 110_000)).toEqual([]);
	});
});
