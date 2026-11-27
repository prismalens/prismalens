// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithApp } from "@/test/render";

// The popover's code lands only when the test says so.
let land: () => void = () => {};
const landed = new Promise<void>((r) => {
	land = r;
});
vi.mock("./ThreadFilters", async (actual) => {
	await landed;
	return actual();
});

const { FilterMenu } = await import("./ThreadList");

describe("the sidebar's Filter (#1193 bar 1.7)", () => {
	it("opens its popover once its code lands when the stand-in was clicked while it loaded", async () => {
		await renderWithApp(<FilterMenu value={{}} onChange={() => {}} />);
		const standIn = document.querySelector<HTMLButtonElement>(
			'[data-testid="sidebar-filter"]',
		);
		expect(standIn).not.toBeNull();
		expect(document.querySelector('[data-testid="thread-filters"]')).toBeNull();

		await act(async () => standIn?.click());
		await act(async () => land());

		await vi.waitFor(() =>
			expect(
				document.querySelector('[data-testid="thread-filters"]'),
			).not.toBeNull(),
		);
	});
});
