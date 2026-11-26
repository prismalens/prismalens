// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/hooks/use-toast";
import { setAttentionToasts } from "@/lib/attention/attention-toasts";
import { Toaster } from "./toaster";

// Holds the toast layer's code until the test lets it load.
const gate = vi.hoisted(() => {
	let open = () => {};
	const loaded = new Promise<void>((r) => {
		open = r;
	});
	return { loaded, open: () => open() };
});
vi.mock("./toast-layer", async (original) => {
	await gate.loaded;
	return original();
});

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
	setAttentionToasts(() => []);
	container.remove();
});

describe("Toaster", () => {
	it("draws the page at once, then is its one Notifications region, holding a toast raised before the toast code loaded and an attention toast", async () => {
		toast({ title: "Copied", duration: Number.POSITIVE_INFINITY });
		setAttentionToasts(() => [
			{
				id: "e1",
				title: "Needs you: Restart the pods",
				body: "",
				threadId: "t1",
				tone: "neutral",
				urgency: 0,
			},
		]);
		await act(async () =>
			root.render(
				createElement(Toaster, null, createElement("p", null, "Page")),
			),
		);
		const before = [
			container.textContent,
			document.querySelectorAll('[role="region"]').length,
		];
		gate.open();

		// The viewport mounts a render before Radix portals the toasts into it.
		await vi.waitFor(
			() =>
				expect(document.querySelector('[role="region"]')?.textContent).toBe(
					"CopiedNeeds you: Restart the pods",
				),
			{ timeout: 10_000 },
		);
		const regions = document.querySelectorAll('[role="region"]');
		expect([
			before,
			Array.from(regions, (r) => r.getAttribute("aria-label")),
			regions[0]?.textContent,
		]).toEqual([
			["Page", 0],
			["Notifications (F8)"],
			"CopiedNeeds you: Restart the pods",
		]);
	});
});
