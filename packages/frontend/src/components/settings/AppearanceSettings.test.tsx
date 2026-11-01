// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FONT_COOKIE } from "@/lib/appearance";
import { AppearanceSettings } from "./AppearanceSettings";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const themeState = {
	choice: "system",
	setTheme: vi.fn(),
};

vi.mock("@/lib/providers/theme-provider", () => ({
	useTheme: () => themeState,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	document.cookie = `${FONT_COOKIE}=; path=/; max-age=0`;
	document.documentElement.style.removeProperty("--font-sans");
	document.documentElement.removeAttribute("data-font");
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	document.cookie = `${FONT_COOKIE}=; path=/; max-age=0`;
	document.documentElement.style.removeProperty("--font-sans");
	document.documentElement.removeAttribute("data-font");
	vi.restoreAllMocks();
});

describe("AppearanceSettings (case 3)", () => {
	it("renders font select trigger with appearance-font test id", async () => {
		await act(async () => root.render(createElement(AppearanceSettings)));
		const trigger = container.querySelector('[data-testid="appearance-font"]');
		expect(trigger).not.toBeNull();
		const schemeSystem = container.querySelector(
			'[data-testid="scheme-system"]',
		);
		expect(schemeSystem).not.toBeNull();
	});
});
