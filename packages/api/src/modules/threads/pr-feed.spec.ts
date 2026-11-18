// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	derive,
	type PollSnapshot,
	translateFeedCursor,
} from "./pr-subscriptions/derive.js";
import { compose, type BundlePr } from "./pr-subscriptions/message.js";

const SHA_A = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

const emptySnap = (over: Partial<PollSnapshot> = {}): PollSnapshot => ({
	prUrl: "https://github.com/acme/shop/pull/12",
	host: "github",
	state: "open",
	title: "Fix bug",
	headSha: SHA_A,
	conflicts: false,
	baseRef: "main",
	items: [],
	issueEvents: [],
	checks: [],
	threads: [],
	push: null,
	reviewsFull: false,
	lists: {},
	floors: {},
	...over,
});

describe("PR subscriptions derivation and message pure functions (#1179)", () => {
	it("baseline derive(null, snap, now) emits no events and initializes cursor", () => {
		const now = new Date("2026-11-11T12:00:00.000Z");
		const snap = emptySnap({
			checks: [
				{ key: "status:build", name: "build", state: "failing", exec: "1", url: "https://github.com/acme/shop/actions/runs/1" },
				{ key: "status:lint", name: "lint", state: "passing", exec: null, url: null },
			],
			items: [
				{ source: "ic", id: 1, login: "alice", bot: false, association: "CONTRIBUTOR", body: "Hello", createdAt: null, link: null },
			],
		});
		const res = derive(null, snap, now);
		expect(res.events).toEqual([]);
		expect(res.cursor.checks["status:build"]).toEqual({ sha: SHA_A, state: "failing", exec: "1" });
		expect(res.cursor.checks["status:lint"]).toEqual({ sha: SHA_A, state: "passing" });
		expect(res.failingNow).toEqual(["status:build"]);
		expect(res.passingNow).toEqual(["status:lint"]);
	});

	it("detects a failing check when cursor has checks part, emitting check and checks_done", () => {
		const now = new Date("2026-11-11T12:00:00.000Z");
		const pendingSnap = emptySnap({
			checks: [
				{ key: "status:build", name: "build", state: "pending", exec: "1", url: "https://github.com/acme/shop/actions/runs/1" },
			],
		});
		const cursor = derive(null, pendingSnap, now).cursor;

		const failingSnap = emptySnap({
			checks: [
				{ key: "status:build", name: "build", state: "failing", exec: "1", url: "https://github.com/acme/shop/actions/runs/1" },
			],
		});
		const res = derive(cursor, failingSnap, now);
		expect(res.events.map((e) => [e.kind, e.dedupeKey])).toEqual([
			["checks_done", `cd:${SHA_A}:failing`],
			["check", `cr:${SHA_A}:status:build:1:failing`],
		]);
		expect(res.events[1]?.payload.check).toEqual({
			name: "build",
			state: "failing",
			url: "https://github.com/acme/shop/actions/runs/1",
		});
		expect(res.failingNow).toEqual(["status:build"]);
	});

	it("a same-SHA rerun that passes after failure gives a check recovered event, and repeat diff gives no events", () => {
		const now = new Date("2026-11-11T12:00:00.000Z");
		const failSnap = emptySnap({
			checks: [
				{ key: "status:build", name: "build", state: "failing", exec: "1", url: null },
			],
		});
		const initial = derive(null, failSnap, now).cursor;

		const passSnap = emptySnap({
			checks: [
				{ key: "status:build", name: "build", state: "passing", exec: "2", url: null },
			],
		});
		const recovered = derive(initial, passSnap, now);
		expect(recovered.events.map((e) => [e.kind, e.payload.check?.state])).toEqual([
			["checks_done", undefined],
			["check", "passing"],
		]);
		expect(recovered.passingNow).toEqual(["status:build"]);

		const secondDiff = derive(recovered.cursor, passSnap, now);
		expect(secondDiff.events).toEqual([]);
	});

	it("conflict false to true emits a conflict event, and true to true emits nothing", () => {
		const now = new Date("2026-11-11T12:00:00.000Z");
		const baseSnap = emptySnap({ conflicts: false });
		const cursor = derive(null, baseSnap, now).cursor;

		const conflictedSnap = emptySnap({ conflicts: true });
		const first = derive(cursor, conflictedSnap, now);
		expect(first.events.map((e) => e.kind)).toEqual(["conflict"]);
		expect(first.events[0]?.dedupeKey).toBe("cf:1");

		const second = derive(first.cursor, conflictedSnap, now);
		expect(second.events).toEqual([]);
	});

	it("new comments and reviews emit events, and seen ids are not emitted again", () => {
		const now = new Date("2026-11-11T12:00:00.000Z");
		const baseSnap = emptySnap({
			items: [
				{ source: "ic", id: 1, login: "alice", bot: false, association: "MEMBER", body: "First comment", createdAt: null, link: null },
			],
		});
		const cursor = derive(null, baseSnap, now).cursor;

		const nextSnap = emptySnap({
			items: [
				{ source: "ic", id: 1, login: "alice", bot: false, association: "MEMBER", body: "First comment", createdAt: null, link: null },
				{ source: "ic", id: 2, login: "bob", bot: false, association: "CONTRIBUTOR", body: "Please fix this", createdAt: null, link: null },
				{ source: "rv", id: 3, login: "carol", bot: false, association: "COLLABORATOR", body: "Changes needed", verdict: "changes_requested", createdAt: null, link: null },
			],
		});
		const res = derive(cursor, nextSnap, now);
		expect(res.events.map((e) => [e.kind, e.dedupeKey])).toEqual([
			["comment", "ic:2"],
			["review", "rv:3"],
		]);
		expect(res.events[0]?.payload.author).toBe("bob");
		expect(res.events[0]?.payload.body).toBe("Please fix this");

		const repeat = derive(res.cursor, nextSnap, now);
		expect(repeat.events).toEqual([]);
	});

	it("state merged gives merged event and sets ended to merged; closed sets ended to closed", () => {
		const now = new Date("2026-11-11T12:00:00.000Z");
		const cursor = derive(null, emptySnap(), now).cursor;

		const mergedSnap = emptySnap({
			state: "merged",
			issueEvents: [{ id: 10, event: "merged", createdAt: null, sha: null }],
		});
		const mergedDiff = derive(cursor, mergedSnap, now);
		expect(mergedDiff.ended).toBe("merged");
		expect(mergedDiff.events.map((e) => e.kind)).toContain("merged");

		const closedSnap = emptySnap({
			state: "closed",
			issueEvents: [{ id: 11, event: "closed", createdAt: null, sha: null }],
		});
		const closedDiff = derive(cursor, closedSnap, now);
		expect(closedDiff.ended).toBe("closed");
		expect(closedDiff.events.map((e) => e.kind)).toContain("closed");
	});

	it("translateFeedCursor translates legacy feed cursor into PollCursor", () => {
		const legacy = JSON.stringify({
			headSha: SHA_A,
			conflicts: false,
			seen: { issue_comment: 42, review: 10 },
			checks: {
				"status:build": { sha: SHA_A, state: "failing", exec: "1" },
			},
		});
		const cursor = translateFeedCursor(legacy);
		expect(cursor).not.toBeNull();
		expect(cursor?.headSha).toBe(SHA_A);
		expect(cursor?.idFloor.ic).toBe(42);
		expect(cursor?.idFloor.rv).toBe(10);
		expect(cursor?.checks["status:build"]).toEqual({ sha: SHA_A, state: "failing", exec: "1" });
		expect(cursor?.checksDone[SHA_A]).toBe("failing");
		expect(cursor?.parts).toEqual(["checks"]);
	});

	it("compose bundles PR events into text with outside lines and fenced untrusted body", () => {
		const pr: BundlePr = {
			prId: "pr-1",
			url: "https://github.com/acme/shop/pull/12",
			host: "github",
			label: "PR #12",
			number: 12,
			title: "Fix connection pool",
			subscriptionIds: ["sub-1"],
			delivery: "wake",
			items: [
				{
					id: 1,
					kind: "check",
					occurredAt: new Date("2026-11-11T12:00:00.000Z"),
					payload: {
						sha: "a1b2c3d",
						check: { name: "build", state: "failing", url: "https://github.com/acme/shop/actions/runs/1" },
					},
				},
				{
					id: 2,
					kind: "comment",
					occurredAt: new Date("2026-11-11T12:05:00.000Z"),
					payload: {
						author: "alice",
						body: "Could you inspect this?",
					},
				},
			],
			more: [],
			superseded: { count: 0, to: null },
		};

		const tag = "testtag";
		const bundle = compose([pr], tag);
		expect(bundle.text).toContain("PrismaLens: 2 new events on PR #12");
		expect(bundle.text).toContain("[d1]");
		expect(bundle.text).toContain("check failed on a1b2c3d - https://github.com/acme/shop/actions/runs/1");
		expect(bundle.text).toContain("[d2]");
		expect(bundle.text).toContain("comment by @alice");
		expect(bundle.text).toContain("<<<PR EVENT TEXT");
		expect(bundle.text).toContain(`[pr·${tag}] PR #12`);
		expect(bundle.text).toContain("Fix connection pool");
		expect(bundle.text).toContain(`[d2·${tag}] comment`);
		expect(bundle.text).toContain("Could you inspect this?");
		expect(bundle.text).toContain("pl_pr_unsubscribe stops a subscription.");
		expect(bundle.summary).toBe("2 events on PR #12: 1 failing check, 1 comment");
	});
});
