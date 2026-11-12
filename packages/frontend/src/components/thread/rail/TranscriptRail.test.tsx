// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IndexEntry } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markLabel, TranscriptRail } from "./TranscriptRail";

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

	it("A render with three entries (a you message, an agent message, and a usage_limit mark) gives a nav named \"Thread outline\" holding 3 links. Exactly one link has tabIndex 0. ArrowUp moves focus to the previous link. Each link's accessible name is the entry's author or mark label, then its preview.", async () => {
		const onJump = vi.fn();
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

		await act(async () => {
			root.render(
				<TranscriptRail
					entries={entries}
					range={{ first: "main:1", last: "main:3" }}
					hits={[]}
					activeHit={null}
					onJump={onJump}
				/>,
			);
		});

		const nav = host.querySelector('nav[aria-label="Thread outline"]');
		expect(nav).not.toBeNull();

		const links = Array.from(host.querySelectorAll<HTMLAnchorElement>("nav a"));
		expect(links.length).toBe(3);

		// Exactly one link has tabIndex 0 (initially entries.length - 1 = index 2)
		const tabIndex0Links = links.filter((link) => link.tabIndex === 0);
		expect(tabIndex0Links.length).toBe(1);
		expect(links[2]?.tabIndex).toBe(0);
		expect(links[0]?.tabIndex).toBe(-1);
		expect(links[1]?.tabIndex).toBe(-1);

		// Each link's accessible name is the entry's author or mark label, then its preview
		const usageMarkLabel = markLabel("usage_limit", "2026-11-12T18:30:00Z");
		expect(links[0]?.getAttribute("aria-label")).toBe(
			"You: Please check the outage",
		);
		expect(links[1]?.getAttribute("aria-label")).toBe(
			"Agent: I will inspect the logs",
		);
		expect(links[2]?.getAttribute("aria-label")).toBe(
			`${usageMarkLabel}: Quota reached`,
		);

		// ArrowUp moves focus to the previous link (from index 2 to index 1)
		const list = host.querySelector("ol");
		expect(list).not.toBeNull();
		await act(async () => {
			list?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
			);
		});

		expect(links[1]?.tabIndex).toBe(0);
		expect(links[2]?.tabIndex).toBe(-1);
	});

	it("Clicking a link calls onJump with that entry's key.", async () => {
		const onJump = vi.fn();
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
		];

		await act(async () => {
			root.render(
				<TranscriptRail
					entries={entries}
					range={{ first: "main:1", last: "main:2" }}
					hits={[]}
					activeHit={null}
					onJump={onJump}
				/>,
			);
		});

		const links = Array.from(host.querySelectorAll<HTMLAnchorElement>("nav a"));
		expect(links.length).toBe(2);

		await act(async () => {
			links[0]?.dispatchEvent(
				new MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});

		expect(onJump).toHaveBeenCalledTimes(1);
		expect(onJump).toHaveBeenCalledWith("main:1");
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
