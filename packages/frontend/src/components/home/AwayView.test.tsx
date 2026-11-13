// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AwayView as AwayData } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AwayFold } from "./AwayView";

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

const thread = (id: string) => ({ thread: { id }, events: [] });
const data = (since: string | null) =>
	({
		since,
		long: false,
		groups: [
			{ root: { id: "a" }, threads: [thread("a"), thread("a1")] },
			{ root: { id: "b" }, threads: [thread("b")] },
		],
	}) as unknown as AwayData;

describe("Home's folded away view (sheet §1, #1101 category 3)", () => {
	it("is one closed mark with the count, naming what changed in its label", async () => {
		await act(async () =>
			root.render(
				<TooltipProvider>
					<AwayFold data={data(null)} now={0} onOpen={() => {}} />
				</TooltipProvider>,
			),
		);
		const line = container.querySelector('[data-testid="away-fold"]');
		// The fold is a mark and its count, its words in the label (the commit making it a mark).
		expect(line?.textContent).toBe("3");
		expect(line?.getAttribute("aria-label")).toBe("3 threads changed");
		expect(line?.getAttribute("aria-expanded")).toBe("false");
	});

	it("opens the list only when clicked", async () => {
		const onOpen = vi.fn();
		await act(async () =>
			root.render(
				<TooltipProvider>
					<AwayFold data={data(null)} now={0} onOpen={onOpen} />
				</TooltipProvider>,
			),
		);
		expect(onOpen).toHaveBeenCalledTimes(0);
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>('[data-testid="away-fold"]')
				?.click(),
		);
		expect(onOpen).toHaveBeenCalledTimes(1);
	});
});
