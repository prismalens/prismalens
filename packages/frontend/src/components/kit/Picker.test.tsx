// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Picker, type PickerOption } from "./Picker";

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

describe("Picker", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		window.matchMedia = vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})) as unknown as typeof window.matchMedia;

		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		document.body.innerHTML = "";
	});

	it("renders trigger with aria-disabled true when locked, and clicking it renders no picker-option elements", async () => {
		const options: PickerOption[] = [
			{ id: "opt-1", name: "Option 1" },
			{ id: "opt-2", name: "Option 2" },
		];
		const onChange = vi.fn();

		await act(async () => {
			root.render(
				<Picker
					label="Model"
					options={options}
					value="opt-1"
					onChange={onChange}
					locked="Fixed for this workspace"
					testId="locked-picker"
				/>,
			);
		});

		const trigger = container.querySelector<HTMLButtonElement>(
			'[data-testid="locked-picker"]',
		);
		expect(trigger?.getAttribute("aria-disabled")).toBe("true");

		await act(async () => {
			trigger?.click();
		});

		const renderedOptions = document.querySelectorAll(
			'[data-testid^="picker-option-"]',
		);
		expect(renderedOptions).toHaveLength(0);
	});

	it("renders one option per entry on click when unlocked, marks current with data-on, and calls onChange with clicked id", async () => {
		const options: PickerOption[] = [
			{ id: "opt-1", name: "Option 1" },
			{ id: "opt-2", name: "Option 2" },
			{ id: "opt-3", name: "Option 3" },
		];
		const onChange = vi.fn();

		await act(async () => {
			root.render(
				<Picker
					label="Model"
					options={options}
					value="opt-2"
					onChange={onChange}
					testId="unlocked-picker"
				/>,
			);
		});

		const trigger = container.querySelector<HTMLButtonElement>(
			'[data-testid="unlocked-picker"]',
		);
		expect(trigger?.getAttribute("aria-disabled")).toBeNull();

		await act(async () => {
			trigger?.click();
		});

		const opt1 = document.querySelector<HTMLElement>(
			'[data-testid="picker-option-opt-1"]',
		);
		const opt2 = document.querySelector<HTMLElement>(
			'[data-testid="picker-option-opt-2"]',
		);
		const opt3 = document.querySelector<HTMLElement>(
			'[data-testid="picker-option-opt-3"]',
		);

		expect(
			Array.from(
				document.querySelectorAll('[data-testid^="picker-option-"]'),
				(e) => e.getAttribute("data-testid"),
			),
		).toEqual([
			"picker-option-opt-1",
			"picker-option-opt-2",
			"picker-option-opt-3",
		]);

		expect(opt1?.getAttribute("data-on")).toBeNull();
		expect(opt2?.getAttribute("data-on")).toBe("true");
		expect(opt3?.getAttribute("data-on")).toBeNull();

		await act(async () => {
			opt3?.click();
		});

		expect(onChange).toHaveBeenCalledWith("opt-3");
	});

	it("renders a search input only when there are 9 or more options (testing 8 and 9)", async () => {
		const options8: PickerOption[] = Array.from({ length: 8 }, (_, i) => ({
			id: `opt-${i}`,
			name: `Option ${i}`,
		}));

		await act(async () => {
			root.render(
				<Picker
					label="Model"
					options={options8}
					value="opt-0"
					onChange={vi.fn()}
					testId="picker-8"
				/>,
			);
		});

		const trigger8 = container.querySelector<HTMLButtonElement>(
			'[data-testid="picker-8"]',
		);
		await act(async () => {
			trigger8?.click();
		});

		expect(document.querySelector("[cmdk-input]")).toBeNull();

		await act(async () => root.unmount());
		document.body.innerHTML = "";
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);

		const options9: PickerOption[] = Array.from({ length: 9 }, (_, i) => ({
			id: `opt-${i}`,
			name: `Option ${i}`,
		}));

		await act(async () => {
			root.render(
				<Picker
					label="Model"
					options={options9}
					value="opt-0"
					onChange={vi.fn()}
					testId="picker-9"
				/>,
			);
		});

		const trigger9 = container.querySelector<HTMLButtonElement>(
			'[data-testid="picker-9"]',
		);
		await act(async () => {
			trigger9?.click();
		});

		expect(document.querySelector("[cmdk-input]")).not.toBeNull();
	});
});
