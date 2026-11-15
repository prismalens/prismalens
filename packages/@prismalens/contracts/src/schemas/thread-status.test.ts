// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	type StatusFacts,
	threadStatus,
} from "./thread-status.js";

const NOW = new Date("2026-11-12T12:00:00.000Z");

const facts = (over: Partial<StatusFacts> = {}): StatusFacts => ({
	live: false,
	askKind: null,
	failed: false,
	stop: null,
	paused: false,
	lastEventAt: new Date("2026-11-12T11:59:00.000Z"),
	waitingOn: null,
	...over,
});

describe("threadStatus (#1101 category 2)", () => {
	it("permission ask -> approval", () => {
		const f = facts({ askKind: "permission", live: true });
		expect(threadStatus(f, NOW)).toEqual({ status: "approval" });
	});

	it("question ask -> question", () => {
		const f = facts({ askKind: "question", live: true });
		expect(threadStatus(f, NOW)).toEqual({ status: "question" });
	});

	it("blocked stop -> blocked with mode", () => {
		const f = facts({
			stop: { blocked: true, mode: "key_rejected" },
		});
		expect(threadStatus(f, NOW)).toEqual({
			status: "blocked",
			mode: "key_rejected",
		});
	});

	it("paused -> blocked paused:true", () => {
		const f = facts({ paused: true });
		expect(threadStatus(f, NOW)).toEqual({
			status: "blocked",
			paused: true,
		});
	});

	it("live quiet >= 5 min -> working with quietSince", () => {
		const lastEventAt = new Date("2026-11-12T11:55:00.000Z"); // exactly 5 min ago
		const f = facts({ live: true, lastEventAt });
		expect(threadStatus(f, NOW)).toEqual({
			status: "working",
			quietSince: lastEventAt.toISOString(),
		});
	});

	it("live fresh -> working without quietSince", () => {
		const lastEventAt = new Date("2026-11-12T11:56:00.000Z"); // 4 min ago (< 5 min)
		const f = facts({ live: true, lastEventAt });
		expect(threadStatus(f, NOW)).toEqual({
			status: "working",
		});
	});

	it("limited stop -> limited", () => {
		const f = facts({
			stop: { blocked: false, mode: "rate_limited" },
		});
		expect(threadStatus(f, NOW)).toEqual({
			status: "limited",
			mode: "rate_limited",
		});
	});

	it("failed -> failed", () => {
		const f = facts({ failed: true });
		expect(threadStatus(f, NOW)).toEqual({ status: "failed" });
	});

	it("waitingOn -> waiting", () => {
		const waitingOn = { kind: "wake" as const, at: "2026-11-12T12:00:00.000Z" };
		const f = facts({ waitingOn });
		expect(threadStatus(f, NOW)).toEqual({
			status: "waiting",
			waitingOn,
		});
	});

	it("else done", () => {
		const f = facts();
		expect(threadStatus(f, NOW)).toEqual({ status: "done" });
	});
});

