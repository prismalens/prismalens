// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { firstMessage } from "./ThreadMenu";
import { threadSchedule } from "./thread.actions";
import { threadHeader, threadRow } from "./thread.surface";

const getEvents = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/orpc-client", () => {
	// Any `orpc.x.y` a module touches on import resolves to another stub.
	const stub: object = new Proxy(() => stub, { get: () => stub });
	return {
		client: { investigations: { getEvents: (a: unknown) => getEvents(a) } },
		orpc: stub,
	};
});


describe("Repeat on a schedule… from a thread (#1101 scheduled tasks)", () => {
	it("is listed only for a standalone thread on the host that saves schedules", () => {
		expect(threadSchedule.when?.({ is: { schedulable: true } })).toBe(true);
		expect(threadSchedule.when?.({ is: { standalone: true } })).toBe(false);
	});

	it("sits in the row's ⋯, its right-click menu and the header's ⋯", () => {
		expect(threadRow.menus.more).toContain("thread.schedule");
		expect(threadRow.menus.context).toContain("thread.schedule");
		expect(threadHeader.menus.more).toContain("thread.schedule");
	});

	it("repeats the thread's first message, not a later one", async () => {
		getEvents.mockResolvedValueOnce({
			events: [
				{ kind: "agent_step", text: "Looking" },
				{ kind: "operator_message", text: "Check the nightly build" },
				{ kind: "operator_message", text: "Thanks" },
			],
			nextCursor: null,
		});
		await expect(firstMessage("t-9")).resolves.toBe("Check the nightly build");
		expect(getEvents).toHaveBeenCalledWith({ id: "t-9", limit: 50 });
	});

	it("starts from an empty brief when the thread has no message of yours", async () => {
		getEvents.mockResolvedValueOnce({
			events: [{ kind: "agent_step", text: "Alert fired" }],
			nextCursor: null,
		});
		await expect(firstMessage("t-10")).resolves.toBe("");
	});
});
