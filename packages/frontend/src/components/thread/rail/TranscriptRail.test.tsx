// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IndexEntry } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	markLabel,
	plainText,
	railItems,
	TranscriptRail,
} from "./TranscriptRail";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("TranscriptRail", () => {
	let host: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		host.remove();
	});

	it('markLabel("usage_limit", "2026-11-12T18:30:00Z") starts with "Usage limit, resets ". markLabel("auth", null) is "API key rejected".', () => {
		const usageLabel = markLabel("usage_limit", "2026-11-12T18:30:00Z");
		expect(usageLabel.startsWith("Usage limit, resets ")).toBe(true);

		const authLabel = markLabel("auth", null);
		expect(authLabel).toBe("API key rejected");
	});

	const entries: IndexEntry[] = [
		[
			"main:1",
			"you",
			null,
			"Please check the outage",
			"2026-11-12T10:00:00Z",
			null,
		],
		[
			"main:2",
			"agent",
			null,
			"I will inspect the logs",
			"2026-11-12T10:01:00Z",
			null,
		],
		[
			"main:3",
			"system",
			"usage_limit",
			"Quota reached",
			"2026-11-12T10:02:00Z",
			"2026-11-12T18:30:00Z",
		],
	];

	// The rail became a stack of turn and break dashes in 700c5be64.
	it("draws a turn dash and a limit dash in a nav named Thread outline, with the turn of the first entry on screen current", async () => {
		await act(async () => {
			root.render(
				<TranscriptRail
					entries={entries}
					range={{ first: "main:2", last: "main:3" }}
					hits={[]}
					activeHit={null}
					onJump={vi.fn()}
				/>,
			);
		});
		const nav = host.querySelector('nav[aria-label="Thread outline"]');
		expect(
			nav?.querySelector('[role="slider"]')?.getAttribute("aria-valuenow"),
		).toBe("1");
		expect(
			Array.from(host.querySelectorAll("[data-rail-item]"), (e) =>
				e.getAttribute("data-rail-item"),
			),
		).toEqual(["turn", "limit"]);
		expect(
			host
				.querySelector('[data-current="true"]')
				?.getAttribute("data-rail-item"),
		).toBe("turn");
	});

	it("marks the turn of a tool event on screen as current", async () => {
		const sparse: IndexEntry[] = [
			["main:1", "you", null, "Check the outage", "2026-11-12T10:00:00Z", null],
			["main:2", "agent", null, "Reading logs", "2026-11-12T10:01:00Z", null],
			["main:500", "you", null, "And the pool?", "2026-11-12T10:05:00Z", null],
			["main:900", "agent", null, "The pool", "2026-11-12T10:09:00Z", null],
		];
		await act(async () => {
			root.render(
				<TranscriptRail
					entries={sparse}
					range={{ first: "main:450", last: "main:460" }}
					hits={[]}
					activeHit={null}
					onJump={vi.fn()}
				/>,
			);
		});
		expect(
			host.querySelector('[role="slider"]')?.getAttribute("aria-valuenow"),
		).toBe("1");
	});

	it("makes the active find hit's dash current while find is open, and Home then Enter calls onJump with the first turn's key", async () => {
		const onJump = vi.fn();
		await act(async () => {
			root.render(
				<TranscriptRail
					entries={entries}
					range={{ first: "main:1", last: "main:2" }}
					hits={["main:3"]}
					activeHit="main:3"
					onJump={onJump}
				/>,
			);
		});
		const slider = host.querySelector<HTMLElement>('[role="slider"]');
		expect(slider?.getAttribute("aria-valuenow")).toBe("2");
		expect(
			host.querySelector('[data-hit="true"]')?.getAttribute("data-rail-item"),
		).toBe("limit");
		for (const key of ["Home", "Enter"])
			await act(async () => {
				slider?.dispatchEvent(
					new KeyboardEvent("keydown", { key, bubbles: true }),
				);
			});
		expect(onJump).toHaveBeenLastCalledWith("main:1");
	});
});

describe("railItems", () => {
	const now = Date.parse("2026-11-12T12:00:00");
	it("gives a turn the agent's last message of the turn as its excerpt, and a break its name and time", () => {
		const items = railItems(
			[
				[
					"main:1",
					"you",
					null,
					"Check **the** outage",
					"2026-11-12T10:00:00",
					null,
				],
				["main:2", "agent", null, "Looking", "2026-11-12T10:01:00", null],
				[
					"main:3",
					"agent",
					null,
					"The `pool` is *full*",
					"2026-11-12T10:02:00",
					null,
				],
				[
					"main:4",
					"system",
					"compaction",
					"Context compacted",
					"2026-11-12T10:03:00",
					null,
				],
				[
					"main:5",
					"system",
					"rate_limit",
					"Slow down",
					"2026-11-12T10:04:00",
					"rate_limited",
				],
			],
			false,
			now,
		);
		expect(items).toEqual([
			{
				id: "main:1",
				kind: "turn",
				title: "Check the outage",
				body: "The pool is full",
			},
			{
				id: "main:4",
				kind: "compaction",
				title: "Context compacted",
				body: "10:03",
			},
			{
				id: "main:5",
				kind: "limit",
				title: "Rate limited",
				body: "10:04 · Slow down",
			},
		]);
	});

	it("draws a run of one break as one dash, and gives a turn with no reply its state", () => {
		const items = railItems(
			[
				["main:1", "you", null, "Deploy", "2026-11-12T10:00:00", null],
				["main:2", "system", "error", "Error", "2026-11-12T10:01:00", null],
				[
					"main:3",
					"system",
					"auth",
					"Key",
					"2026-11-12T10:02:00",
					"key_rejected",
				],
				["main:4", "you", null, "Again", "2026-11-12T10:03:00", null],
			],
			true,
			now,
		);
		expect(items.map((i) => [i.id, i.kind, i.state])).toEqual([
			["main:1", "turn", "failed"],
			["main:2", "failure", undefined],
			["main:4", "turn", "working"],
		]);
	});

	it("reads a message start as plain text with no code fence, markup or JSON", () => {
		expect(plainText("## Cause\n- the [pool](http://x) is _full_")).toBe(
			"Cause the pool is full",
		);
		expect(plainText('Output: ```json {"a":1}')).toBe("Output:");
		expect(plainText('{"status": "ok", "count": 3}')).toBe("");
	});

	it("a turn's body is its last agent message with words; a later agent message that parses to nothing does not replace it", () => {
		const entries: IndexEntry[] = [
			["main:1", "you", null, "Please inspect", "2026-11-12T10:00:00", null],
			[
				"main:2",
				"agent",
				null,
				"I checked the database and found high latency",
				"2026-11-12T10:01:00",
				null,
			],
			[
				"main:3",
				"agent",
				null,
				'{"status": "ok", "count": 42}',
				"2026-11-12T10:02:00",
				null,
			],
			[
				"main:4",
				"agent",
				null,
				"```\ncode fence only\n```",
				"2026-11-12T10:03:00",
				null,
			],
		];
		const items = railItems(entries, false, now);
		expect(items[0]?.body).toBe(
			"I checked the database and found high latency",
		);
	});

	it("a break before any agent words marks the turn, while a break after the agent said words does not", () => {
		const failItems = railItems(
			[
				["main:1", "you", null, "Deploy service", "2026-11-12T10:00:00", null],
				[
					"main:2",
					"system",
					"error",
					"Fatal crash",
					"2026-11-12T10:01:00",
					null,
				],
			],
			false,
			now,
		);
		expect(failItems[0]?.state).toBe("failed");

		const limitItems = railItems(
			[
				["main:1", "you", null, "Query API", "2026-11-12T10:00:00", null],
				[
					"main:2",
					"system",
					"usage_limit",
					"Quota exceeded",
					"2026-11-12T10:01:00",
					null,
				],
			],
			false,
			now,
		);
		expect(limitItems[0]?.state).toBe("limited");

		const afterItems = railItems(
			[
				["main:1", "you", null, "Query API", "2026-11-12T10:00:00", null],
				[
					"main:2",
					"agent",
					null,
					"Here is the response",
					"2026-11-12T10:01:00",
					null,
				],
				[
					"main:3",
					"system",
					"error",
					"Fatal crash",
					"2026-11-12T10:02:00",
					null,
				],
			],
			false,
			now,
		);
		expect(afterItems[0]?.body).toBe("Here is the response");
		expect(afterItems[0]?.state).toBeUndefined();
	});

	it("with several breaks before any words, the last one decides", () => {
		const itemsErrorLast = railItems(
			[
				["main:1", "you", null, "Run task", "2026-11-12T10:00:00", null],
				[
					"main:2",
					"system",
					"usage_limit",
					"Quota hit",
					"2026-11-12T10:01:00",
					null,
				],
				[
					"main:3",
					"system",
					"error",
					"Service down",
					"2026-11-12T10:02:00",
					null,
				],
			],
			false,
			now,
		);
		expect(itemsErrorLast[0]?.state).toBe("failed");

		const itemsLimitLast = railItems(
			[
				["main:1", "you", null, "Run task", "2026-11-12T10:00:00", null],
				[
					"main:2",
					"system",
					"error",
					"Service down",
					"2026-11-12T10:02:00",
					null,
				],
				[
					"main:3",
					"system",
					"rate_limit",
					"Slow down",
					"2026-11-12T10:02:00",
					null,
				],
			],
			false,
			now,
		);
		expect(itemsLimitLast[0]?.state).toBe("limited");
	});

	it("plainText returns the same result for the same input twice and strips markup as before", () => {
		const md =
			"### Title with **bold** and [link](https://example.com) and `code`";
		const first = plainText(md);
		const second = plainText(md);
		expect(first).toBe("Title with bold and link and code");
		expect(second).toBe(first);
	});
});

describe("markLabel for provider stops (#1101 cat 17)", () => {
	it("names each stop: rate limited, overloaded, out of credit and spend cap", () => {
		expect(markLabel("rate_limit", "rate_limited")).toBe("Rate limited");
		expect(markLabel("rate_limit", "overloaded")).toBe("Provider overloaded");
		expect(markLabel("blocked", "out_of_credit")).toBe("Out of credit");
		expect(markLabel("blocked", "spend_cap")).toBe("Spend cap reached");
	});
});
