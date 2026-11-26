// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { toast } from "@/hooks/use-toast";
import { Toaster } from "./toaster";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The toast layer's first fetch fails, as on a dropped link; later fetches load it.
const link = vi.hoisted(() => ({ fetches: 0 }));
vi.mock("./toast-layer", async (original) => {
	link.fetches += 1;
	if (link.fetches === 1)
		throw new Error("Failed to fetch dynamically imported module");
	return original();
});

describe("Toaster when the toast code fails to load", () => {
	it("loads it again when the browser is back online and shows the toast raised meanwhile, without a remount", async () => {
		const el = document.body.appendChild(document.createElement("div"));
		const root = createRoot(el);
		const page = createElement("p", null, "Page");
		await act(async () => root.render(createElement(Toaster, null, page)));
		await vi.waitFor(() => expect(link.fetches).toBe(1));
		await act(async () => {
			toast({ title: "Saved", duration: Number.POSITIVE_INFINITY });
		});
		const whileDown = document.querySelectorAll('[role="region"]').length;

		await act(async () => {
			window.dispatchEvent(new Event("online"));
		});

		await vi.waitFor(
			() =>
				expect(document.querySelector('[role="region"]')?.textContent).toBe(
					"Saved",
				),
			{ timeout: 4_000 },
		);
		expect([whileDown, link.fetches]).toEqual([0, 2]);
		await act(async () => root.unmount());
		el.remove();
	});
});
