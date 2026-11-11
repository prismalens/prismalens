// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceDisplayGroup } from "./SourceDisplaySettings";

const updateContextSpy = vi.fn();
const setImagesSpy = vi.fn();
let mockContextData: { prStatus: boolean; editor: string } | undefined;
let mockHostImages = true;
const mockOperator = { managesPairing: true };

vi.mock("@/lib/api/hooks/use-app-settings-orpc", () => ({
	useThreadContextSettings: () => ({
		data: mockContextData,
		isPending: false,
	}),
	useUpdateThreadContextSettings: () => ({
		mutate: updateContextSpy,
		isPending: false,
	}),
	useHostImages: () => mockHostImages,
	useSetHostImages: () => ({
		mutate: setImagesSpy,
		isPending: false,
	}),
}));

vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => mockOperator,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	updateContextSpy.mockClear();
	setImagesSpy.mockClear();
	mockContextData = undefined;
	mockHostImages = true;
	mockOperator.managesPairing = true;
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("SourceDisplaySettings", () => {
	it("disables pull request switch when data is absent and toggles when data is present", async () => {
		mockContextData = undefined;

		await act(async () => {
			root.render(<SourceDisplayGroup />);
		});

		const disabledSwitch = container.querySelector<HTMLButtonElement>(
			'[data-testid="sources-pr-status"]',
		);
		expect(disabledSwitch?.disabled).toBe(true);

		mockContextData = { prStatus: true, editor: "system" };
		await act(async () => {
			root.render(<SourceDisplayGroup />);
		});

		const activeSwitch = container.querySelector<HTMLButtonElement>(
			'[data-testid="sources-pr-status"]',
		);
		expect(activeSwitch?.getAttribute("aria-checked")).toBe("true");

		await act(async () => {
			activeSwitch?.click();
		});
		expect(updateContextSpy).toHaveBeenCalledWith({ prStatus: false });
	});

	it("checks images switch when useHostImages returns true and toggles to disabled on click", async () => {
		mockHostImages = true;

		await act(async () => {
			root.render(<SourceDisplayGroup />);
		});

		const imagesSwitch = container.querySelector<HTMLButtonElement>(
			'[data-testid="sources-host-images"]',
		);
		expect(imagesSwitch?.getAttribute("aria-checked")).toBe("true");

		await act(async () => {
			imagesSwitch?.click();
		});
		expect(setImagesSpy).toHaveBeenCalledWith({ enabled: false });
	});
});
