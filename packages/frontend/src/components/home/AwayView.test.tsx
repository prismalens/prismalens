// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AwayView as AwayData } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
	it("is one closed line naming what changed and how many threads", async () => {
		await act(async () =>
			root.render(<AwayFold data={data(null)} now={0} onOpen={() => {}} />),
		);
		const line = container.querySelector('[data-testid="away-fold"]');
		expect(line?.textContent).toBe("What changed3");
		expect(line?.getAttribute("aria-expanded")).toBe("false");
	});

	it("opens the list only when clicked", async () => {
		const onOpen = vi.fn();
		await act(async () =>
			root.render(<AwayFold data={data(null)} now={0} onOpen={onOpen} />),
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
