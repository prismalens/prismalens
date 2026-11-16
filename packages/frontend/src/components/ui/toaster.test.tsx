// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Toast, ToastTitle } from "./toast";
import { Toaster } from "./toaster";

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

describe("Toaster", () => {
	it("is the page's one Notifications region, and a child's toast lands in it", async () => {
		const child = createElement(
			Toast,
			{ open: true, duration: Number.POSITIVE_INFINITY },
			createElement(ToastTitle, null, "Needs you: Restart the pods"),
		);
		await act(async () => root.render(createElement(Toaster, null, child)));

		const regions = document.querySelectorAll('[role="region"]');
		expect(Array.from(regions, (r) => r.getAttribute("aria-label"))).toEqual([
			"Notifications (F8)",
		]);
		expect(regions[0]?.textContent).toBe("Needs you: Restart the pods");
	});
});
