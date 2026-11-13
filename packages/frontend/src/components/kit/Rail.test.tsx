// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Rail, type RailItem, railWindow } from "./Rail";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The rail became a windowed stack of turn and break dashes in 700c5be64.
describe("railWindow", () => {
	it("keeps 10 of 10 items whole, and centres 15 of 1,250 on item 612 as 605 to 620", () => {
		expect(railWindow(10, 4)).toEqual({ start: 0, end: 10 });
		expect(railWindow(1250, 612)).toEqual({ start: 605, end: 620 });
	});

	it("pins the window to 0 to 15 near the start and 1,235 to 1,250 near the end", () => {
		expect(railWindow(1250, 2)).toEqual({ start: 0, end: 15 });
		expect(railWindow(1250, 1249)).toEqual({ start: 1235, end: 1250 });
	});
});

describe("Rail", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	it("draws 5 dashes with item-1 current, moves the card with ArrowDown, PageDown and End, and jumps on Enter and F", async () => {
		const onJump = vi.fn();
		const items: RailItem[] = [
			{ id: "item-0", kind: "turn", title: "Turn 0", body: "Reply 0" },
			{ id: "item-1", kind: "turn", title: "Turn 1", body: "Reply 1" },
			{ id: "item-2", kind: "turn", title: "Turn 2", body: "Reply 2" },
			{ id: "item-3", kind: "failure", title: "Error", body: "10:02" },
			{ id: "item-4", kind: "turn", title: "Turn 4", state: "working" },
		];

		await act(async () => {
			root.render(<Rail items={items} current="item-1" onJump={onJump} />);
		});

		const rail = container.querySelector<HTMLDivElement>(
			'[data-testid="rail"]',
		);
		const key = (k: string) =>
			act(async () => {
				rail?.dispatchEvent(
					new KeyboardEvent("keydown", { key: k, bubbles: true }),
				);
			});
		const card = () =>
			container.querySelector('[data-testid="rail-card"]')?.textContent;

		expect(
			Array.from(container.querySelectorAll("[data-rail-item]"), (e) =>
				e.getAttribute("data-rail-item"),
			),
		).toEqual(["turn", "turn", "turn", "failure", "turn"]);
		expect(
			container.querySelector('[data-current="true"]') ===
				container.querySelectorAll("[data-rail-item]")[1],
		).toBe(true);

		await key("ArrowDown");
		expect(card()).toBe("Turn 2Reply 2");
		await key("PageDown");
		expect(card()).toBe("Error10:02");
		await key("End");
		expect(card()).toBe("Turn 4Working");
		expect(onJump).not.toHaveBeenCalled();

		await key("Enter");
		expect(onJump).toHaveBeenLastCalledWith("item-4");
		await key("F");
		expect(onJump).toHaveBeenLastCalledWith("item-3");
	});

	it("lists each dash as a screen-reader jump link, a turn by its message and a break by its name and time, and jumps on click", async () => {
		const onJump = vi.fn();
		const items: RailItem[] = [
			{ id: "a", kind: "turn", title: "Fix the build", body: "Done" },
			{ id: "b", kind: "limit", title: "Usage limit", body: "09:40" },
		];
		await act(async () => {
			root.render(<Rail items={items} current="b" onJump={onJump} />);
		});
		const links = Array.from(
			container.querySelectorAll<HTMLButtonElement>(
				'[data-testid="rail-links"] button',
			),
		);
		expect(links.map((l) => l.textContent)).toEqual([
			"Fix the build",
			"Usage limit, 09:40",
		]);
		expect(links.map((l) => l.getAttribute("aria-current"))).toEqual([
			null,
			"true",
		]);
		expect(links.map((l) => l.tabIndex)).toEqual([-1, -1]);
		await act(async () => links[0].click());
		expect(onJump).toHaveBeenLastCalledWith("a");
	});

	it("draws 15 of 1,250 dashes around the current one, fading the two at each end", async () => {
		const items: RailItem[] = Array.from({ length: 1250 }, (_, i) => ({
			id: `t${i}`,
			kind: "turn",
			title: `Turn ${i}`,
		}));
		await act(async () => {
			root.render(<Rail items={items} current="t612" onJump={vi.fn()} />);
		});
		const dashes = Array.from(
			container.querySelectorAll<HTMLElement>("[data-rail-item]"),
		);
		expect(dashes).toHaveLength(15);
		expect(dashes.findIndex((d) => d.dataset.current === "true")).toBe(7);
		expect(dashes.map((d) => d.style.opacity)).toEqual([
			"0.3",
			"0.6",
			...Array(11).fill(""),
			"0.6",
			"0.3",
		]);
	});
});
