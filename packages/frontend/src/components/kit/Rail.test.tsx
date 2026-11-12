// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clusterTicks, nearest, Rail, type RailItem } from "./Rail";

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("nearest", () => {
	it("returns 0 for 0.2, 1 for 0.6, and 2 for 0.9 on items at 0, 0.5, 1", () => {
		const items: RailItem[] = [
			{ id: "item-0", at: 0, author: "you", preview: "Item 0" },
			{ id: "item-1", at: 0.5, author: "agent", preview: "Item 1" },
			{ id: "item-2", at: 1, author: "thread", preview: "Item 2" },
		];
		expect(nearest(items, 0.2)).toBe(0);
		expect(nearest(items, 0.6)).toBe(1);
		expect(nearest(items, 0.9)).toBe(2);
	});
});

describe("clusterTicks", () => {
	const item = (
		id: string,
		at: number,
		author: RailItem["author"],
		mark?: RailItem["mark"],
	): RailItem => ({ id, at, author, mark, preview: id });
	// At 100 px tall with a 3 px gap: 0, 0.01 and 0.02 touch; 0.5 and 1 stand alone.
	const items = [
		item("a", 0, "you"),
		item("b", 0.01, "agent", "compaction"),
		item("c", 0.02, "thread", "failure"),
		item("d", 0.5, "thread"),
		item("e", 1, "you", "limit"),
	];

	it("merges items closer than 3 px into one tick with the agent's length, the strongest mark, and current and hit from any member", () => {
		expect(clusterTicks(items, 100, 2, new Set(["a"]))).toEqual([
			{
				at: 0,
				first: 0,
				last: 2,
				author: "agent",
				mark: "failure",
				current: true,
				hit: true,
			},
			{
				at: 0.5,
				first: 3,
				last: 3,
				author: "thread",
				mark: undefined,
				current: false,
				hit: false,
			},
			{
				at: 1,
				first: 4,
				last: 4,
				author: "you",
				mark: "limit",
				current: false,
				hit: false,
			},
		]);
	});

	it("keeps every item as its own tick while the height is unmeasured", () => {
		expect(clusterTicks(items, 0, -1, new Set()).map((t) => t.first)).toEqual([
			0, 1, 2, 3, 4,
		]);
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

	it("renders 5 items with item 1 having data-current, and jumps on ArrowDown, PageDown, Home, End", async () => {
		const onJump = vi.fn();
		const items: RailItem[] = [
			{ id: "item-0", at: 0, author: "you", preview: "Turn 0" },
			{ id: "item-1", at: 0.25, author: "agent", preview: "Turn 1" },
			{ id: "item-2", at: 0.5, author: "agent", preview: "Turn 2" },
			{
				id: "item-3",
				at: 0.75,
				author: "agent",
				mark: "failure",
				preview: "Turn 3",
			},
			{ id: "item-4", at: 1, author: "thread", preview: "Turn 4" },
		];

		await act(async () => {
			root.render(<Rail items={items} current="item-1" onJump={onJump} />);
		});

		const rail = container.querySelector<HTMLDivElement>(
			'[data-testid="rail"]',
		);
		expect(rail).not.toBeNull();

		const lines = container.querySelectorAll("[data-rail-item]");
		expect(lines).toHaveLength(5);
		expect(lines[1].getAttribute("data-current")).toBe("true");

		await act(async () => {
			rail?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
			);
		});
		expect(onJump).toHaveBeenLastCalledWith("item-2");

		await act(async () => {
			rail?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }),
			);
		});
		expect(onJump).toHaveBeenLastCalledWith("item-3");

		await act(async () => {
			rail?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
			);
		});
		expect(onJump).toHaveBeenLastCalledWith("item-0");

		await act(async () => {
			rail?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "End", bubbles: true }),
			);
		});
		expect(onJump).toHaveBeenLastCalledWith("item-4");
	});
});
