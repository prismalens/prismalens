// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IndexEntry } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markLabel, railPreview, TranscriptRail } from "./TranscriptRail";

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

	it("draws one line per entry in a nav named Thread outline, the mark as a limit line, and the first entry on screen as current", async () => {
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
		).toEqual(["you", "agent", "limit"]);
		expect(
			host
				.querySelector('[data-current="true"]')
				?.getAttribute("data-rail-item"),
		).toBe("agent");
	});

	it("makes the active find hit current while find is open, and Home calls onJump with the first entry's key", async () => {
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
		await act(async () => {
			slider?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
			);
		});
		expect(onJump).toHaveBeenLastCalledWith("main:1");
	});

	it("previews a mark by its name and its text, never the name twice", () => {
		expect(railPreview(entries[2])).toBe(
			`${markLabel("usage_limit", "2026-11-12T18:30:00Z")}: Quota reached`,
		);
		expect(
			railPreview([
				"main:4",
				"system",
				"error",
				"Error",
				"2026-11-12T10:03:00Z",
				null,
			]),
		).toBe("Error");
		expect(
			railPreview(["main:5", "you", null, "Hi", "2026-11-12T10:04:00Z", null]),
		).toBe("You: Hi");
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
