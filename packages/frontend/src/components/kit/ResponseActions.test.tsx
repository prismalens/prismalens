// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResponseActions } from "./ResponseActions";

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

describe("ResponseActions", () => {
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
		document.body.innerHTML = "";
	});

	it.each([
		["Shift+F10", { key: "F10", shiftKey: true }],
		["the Menu key", { key: "ContextMenu" }],
	])(
		"opens the message menu with Copy and Fork from here on %s from a focused icon",
		async (_name, key) => {
			await act(async () => {
				root.render(<ResponseActions text="Done." onFork={() => {}} />);
			});
			const copy = container.querySelector<HTMLButtonElement>(
				'[data-testid="response-copy"]',
			);
			copy?.focus();
			await act(async () => {
				copy?.dispatchEvent(
					new KeyboardEvent("keydown", {
						...key,
						bubbles: true,
						cancelable: true,
					}),
				);
			});
			const menu = document.querySelector('[role="menu"]');
			expect(menu?.getAttribute("aria-label")).toBe("Message actions");
			expect(
				Array.from(menu?.querySelectorAll('[role="menuitem"]') ?? []).map(
					(i) => i.textContent,
				),
			).toEqual(["Copy", "Fork from here"]);
		},
	);
});
