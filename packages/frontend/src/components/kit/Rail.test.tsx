// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nearest, Rail, type RailItem } from "./Rail";

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
