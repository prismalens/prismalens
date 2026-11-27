// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { renderWithApp } from "@/test/render";
import { ThreadFilterButton } from "./ThreadFilters";

describe("ThreadFilterButton (#1193 bar 1.7)", () => {
	it("opens when a click on its stand-in landed after its first render, before it committed", async () => {
		// The stand-in's click sets the flag only once the real button has rendered closed.
		let clicked = false;
		const takeOpen = () => {
			const was = clicked;
			clicked = false;
			return was;
		};
		const Late = () => {
			clicked = true;
			return null;
		};

		await renderWithApp(
			<>
				<ThreadFilterButton
					value={{}}
					onChange={() => {}}
					takeOpen={takeOpen}
				/>
				<Late />
			</>,
		);

		await vi.waitFor(() =>
			expect(
				document.querySelector('[data-testid="thread-filters"]'),
			).not.toBeNull(),
		);
	});
});
