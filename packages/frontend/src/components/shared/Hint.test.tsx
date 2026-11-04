// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Hint } from "./Hint";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("Hint (#1020)", () => {
	let host: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
	});
	afterEach(() => {
		act(() => root.unmount());
		host.remove();
	});

	const render = (open: boolean) =>
		act(() =>
			root.render(
				<TooltipProvider>
					<Hint label="Files" open={open}>
						<span>icon</span>
					</Hint>
				</TooltipProvider>,
			),
		);

	it("shows when told to, for a tab whose focus lands on its parent", () => {
		render(false);
		expect(document.querySelector('[data-testid="hint"]')).toBeNull();
		render(true);
		expect(
			document.querySelector('[data-testid="hint"]')?.textContent,
		).toContain("Files");
		render(false);
		expect(document.querySelector('[data-testid="hint"]')).toBeNull();
	});
});

describe("Hint on Escape (#1020)", () => {
	it("closes a hint its parent holds open when Escape asks it to", async () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host);
		act(() =>
			root.render(
				<TooltipProvider>
					<Hint label="Files" open>
						<button type="button">icon</button>
					</Hint>
				</TooltipProvider>,
			),
		);
		expect(document.querySelector('[data-testid="hint"]')).not.toBeNull();
		act(() => {
			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		expect(document.querySelector('[data-testid="hint"]')).toBeNull();
		act(() => root.unmount());
		host.remove();
	});
});
