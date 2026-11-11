// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeSlots } from "./index";
import { DOCK_ORDER, type LaneSlots } from "./types";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("DOCK_ORDER (#1024)", () => {
	it("equals exactly ask 10, usageLimit 20, coldConversation 30", () => {
		expect(DOCK_ORDER).toEqual({
			ask: 10,
			usageLimit: 20,
			coldConversation: 30,
		});
	});
});

describe("mergeSlots (#1024)", () => {
	it("renders docks from three lanes with orders 30, 10, 20 top-first in order 10, 20, 30 in DOM", async () => {
		const lane30: LaneSlots = {
			dock: [{ id: "dock-30", order: 30, node: <span>lane 30</span> }],
		};
		const lane10: LaneSlots = {
			dock: [{ id: "dock-10", order: 10, node: <span>lane 10</span> }],
		};
		const lane20: LaneSlots = {
			dock: [{ id: "dock-20", order: 20, node: <span>lane 20</span> }],
		};

		const slots = mergeSlots([lane30, lane10, lane20]);
		await act(async () => {
			root.render(<div>{slots.dock}</div>);
		});

		const elements = Array.from(container.querySelectorAll("[data-dock]"));
		expect(elements.map((el) => el.getAttribute("data-dock"))).toEqual([
			"dock-10",
			"dock-20",
			"dock-30",
		]);
	});

	it("adds nothing for a lane with dock: [null] and returns null dock, banner, composerFooter, and empty interceptors for all-empty set", () => {
		const emptyLane: LaneSlots = { dock: [null] };
		const slots = mergeSlots([emptyLane, {}]);

		expect(slots.dock).toBeNull();
		expect(slots.banner).toBeNull();
		expect(slots.composerFooter).toBeNull();
		expect(slots.interceptors).toEqual([]);
	});
});
