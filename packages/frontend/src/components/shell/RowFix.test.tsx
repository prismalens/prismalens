// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListNode } from "@/lib/thread-list";
import { RowFix } from "./RowFix";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const freeSpace = vi.fn();
vi.mock("@/components/home/use-needs-ctx", () => ({
	useNeedsCtx: () => ({
		answer: vi.fn(),
		updateKey: vi.fn(),
		account: vi.fn(),
		accountLabel: "",
		freeSpace,
		signInCommand: null,
		retryNow: vi.fn(),
		resume: vi.fn(),
		open: vi.fn(),
		facts: { is: { disk: true } },
	}),
}));

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

describe("a needs-you row's fix (#1193)", () => {
	it("names its registered action by its full id, reads its label, and runs it", async () => {
		await act(async () =>
			root.render(
				createElement(RowFix, {
					node: {} as ListNode,
					id: "needs.freeSpace",
				}),
			),
		);
		const fix = container.querySelector<HTMLButtonElement>(
			'[data-testid="row-fix"]',
		);
		expect(fix?.getAttribute("data-fix")).toBe("needs.freeSpace");
		expect(fix?.textContent).toBe("Free space");
		await act(async () => fix?.click());
		expect(freeSpace).toHaveBeenCalledTimes(1);
	});
});
