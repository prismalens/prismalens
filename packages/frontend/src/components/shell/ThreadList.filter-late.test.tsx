// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithApp } from "@/test/render";

let land: () => void = () => {};
const landed = new Promise<void>((r) => {
	land = r;
});
// The stand-in is still on the page while the loaded button renders: the click lands then,
// after the button has rendered and before it commits.
let clicked = false;
function LateClick() {
	if (!clicked) {
		clicked = true;
		document
			.querySelector<HTMLButtonElement>('[data-testid="sidebar-filter"]')
			?.click();
	}
	return null;
}
vi.mock("./ThreadFilters", async (actual) => {
	await landed;
	const m = await actual<typeof import("./ThreadFilters")>();
	return {
		...m,
		ThreadFilterButton: (
			props: ComponentProps<typeof m.ThreadFilterButton>,
		) => (
			<>
				<m.ThreadFilterButton {...props} />
				<LateClick />
			</>
		),
	};
});

const { FilterMenu } = await import("./ThreadList");

describe("the sidebar's Filter (#1193 bar 1.7)", () => {
	it("opens its popover when the stand-in is clicked after the loaded button renders but before it commits", async () => {
		await renderWithApp(<FilterMenu value={{}} onChange={() => {}} />);
		expect(
			document.querySelector('[data-testid="sidebar-filter"]'),
		).not.toBeNull();

		// The load starts without a click, as it does after the page's first content.
		await act(async () => {
			void FilterMenu.preload(true);
			land();
		});

		await vi.waitFor(() => expect(clicked).toBe(true));
		await vi.waitFor(() =>
			expect(
				document.querySelector('[data-testid="thread-filters"]'),
			).not.toBeNull(),
		);
	});
});
