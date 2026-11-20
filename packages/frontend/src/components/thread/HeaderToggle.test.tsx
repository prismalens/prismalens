// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderToggle } from "./HeaderToggle";

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: React.ReactNode }) => children,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("HeaderToggle", () => {
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

	it("renders button with accessibility attributes and responds to click", async () => {
		const onToggle = vi.fn();
		await act(async () => {
			root.render(
				<HeaderToggle
					label="Open the panel"
					pressed={false}
					disabled={false}
					onToggle={onToggle}
					icon={<span data-testid="toggle-icon">Icon</span>}
					testId="panel-toggle"
					controls="thread-panel"
				/>,
			);
		});

		const btn = container.querySelector<HTMLButtonElement>(
			'[data-testid="panel-toggle"]',
		);
		expect(btn).not.toBeNull();
		expect(btn?.getAttribute("aria-label")).toBe("Open the panel");
		expect(btn?.getAttribute("aria-expanded")).toBe("false");
		expect(btn?.getAttribute("aria-controls")).toBe("thread-panel");
		expect(btn?.disabled).toBe(false);

		await act(async () => {
			btn?.click();
		});

		expect(onToggle).toHaveBeenCalledTimes(1);
	});

	it("reflects pressed state and disabled state", async () => {
		const onToggle = vi.fn();
		await act(async () => {
			root.render(
				<HeaderToggle
					label="Close pane"
					pressed={true}
					disabled={true}
					onToggle={onToggle}
					icon={<span data-testid="toggle-icon">Icon</span>}
					testId="panel-toggle"
					controls="thread-panel"
				/>,
			);
		});

		const btn = container.querySelector<HTMLButtonElement>(
			'[data-testid="panel-toggle"]',
		);
		expect(btn?.getAttribute("aria-expanded")).toBe("true");
		expect(btn?.disabled).toBe(true);

		await act(async () => {
			btn?.click();
		});

		expect(onToggle).not.toHaveBeenCalled();
	});
});
