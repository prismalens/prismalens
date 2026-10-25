// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutPrefs } from "./use-layout-prefs";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.resetModules();
	window.localStorage.clear();
	document.documentElement.removeAttribute("data-sidebar-folded");
	document.documentElement.removeAttribute("data-sidebar-hidden");
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	window.localStorage.clear();
	document.documentElement.removeAttribute("data-sidebar-folded");
	document.documentElement.removeAttribute("data-sidebar-hidden");
});

describe("useLayoutPrefs (case 2)", () => {
	it("migrates pre-#848 sidebarFolded: true to folded rest and state", async () => {
		window.localStorage.setItem(
			"pl.layout",
			JSON.stringify({ sidebarFolded: true }),
		);
		const { useLayoutPrefs } = await import("./use-layout-prefs");
		let hookResult!: ReturnType<typeof useLayoutPrefs>;
		function TestComponent() {
			hookResult = useLayoutPrefs();
			return null;
		}

		await act(async () => root.render(createElement(TestComponent)));

		expect(hookResult.sidebar).toBe("folded");
		expect(hookResult.sidebarRest).toBe("folded");
		expect(hookResult.sidebarFolded).toBe(true);
		expect(hookResult.sidebarHidden).toBe(false);
	});

	it("hides sidebar completely on toggle, stamps root attribute, and restores to rest width", async () => {
		const { useLayoutPrefs } = await import("./use-layout-prefs");
		let hookResult!: ReturnType<typeof useLayoutPrefs>;
		function TestComponent() {
			hookResult = useLayoutPrefs();
			return null;
		}

		await act(async () => root.render(createElement(TestComponent)));
		expect(hookResult.sidebar).toBe("full");
		expect(hookResult.sidebarHidden).toBe(false);

		// Hide
		await act(async () => hookResult.toggleSidebar());
		expect(hookResult.sidebar).toBe("hidden");
		expect(hookResult.sidebarHidden).toBe(true);
		expect(document.documentElement.hasAttribute("data-sidebar-hidden")).toBe(
			true,
		);
		const raw = JSON.parse(window.localStorage.getItem("pl.layout") ?? "{}");
		expect(raw.sidebar).toBe("hidden");

		// Restore
		await act(async () => hookResult.toggleSidebar());
		expect(hookResult.sidebar).toBe("full");
		expect(hookResult.sidebarHidden).toBe(false);
		expect(document.documentElement.hasAttribute("data-sidebar-hidden")).toBe(
			false,
		);
	});

	it("updates resting width via setSidebarRest", async () => {
		const { useLayoutPrefs } = await import("./use-layout-prefs");
		let hookResult!: ReturnType<typeof useLayoutPrefs>;
		function TestComponent() {
			hookResult = useLayoutPrefs();
			return null;
		}

		await act(async () => root.render(createElement(TestComponent)));
		await act(async () => hookResult.setSidebarRest("folded"));

		expect(hookResult.sidebar).toBe("folded");
		expect(hookResult.sidebarRest).toBe("folded");
		expect(hookResult.sidebarFolded).toBe(true);
	});
});
