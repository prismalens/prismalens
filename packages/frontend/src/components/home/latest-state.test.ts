// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	AttentionEvent,
	AttentionKind,
	AwayView as AwayData,
	ThreadStatus,
} from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { currentEvent, digestLines, unreadThreadCount } from "./AwayView";

const event = (
	id: string,
	kind: AttentionKind,
	threadId = "t1",
	readAt: string | null = null,
) =>
	({
		id,
		kind,
		threadId,
		readAt,
		at: "2026-11-24T10:00:00Z",
		thread: { id: threadId, status: "done", title: "Checkout", incident: null },
	}) as unknown as AttentionEvent;

const away = (status: ThreadStatus, events: AttentionEvent[]) =>
	({
		since: null,
		long: false,
		groups: [
			{
				root: { id: "t1" },
				threads: [
					{ thread: { id: "t1", status, title: "Checkout", incident: null }, events },
				],
			},
		],
	}) as unknown as AwayData;

describe("one latest-run state per thread", () => {
	it("reads Done, not Failed, for a thread whose failed run was followed by a finished one", () => {
		const events = [event("e1", "failed"), event("e2", "finished")];
		expect(currentEvent(events, "done")?.id).toBe("e2");
		expect(digestLines(away("done", events))[0]?.status).toBe("done");
	});

	it("keeps a stop leading while the thread is still stopped", () => {
		const events = [event("e1", "started"), event("e2", "failed")];
		expect(digestLines(away("failed", events))[0]?.status).toBe("failed");
	});

	it("counts threads, not events, so Unread 5 never sits over 3 rows", () => {
		const events = [
			event("e1", "failed", "a"),
			event("e2", "finished", "a"),
			event("e3", "started", "b"),
			event("e4", "finished", "b"),
			event("e5", "failed", "c"),
			event("e6", "finished", "c", "2026-11-24T11:00:00Z"),
		];
		expect(unreadThreadCount(events)).toBe(3);
	});
});
