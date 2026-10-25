// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	SYSTEM_DARK,
	THEME_COOKIE,
	getThemeChoice,
	readCookie,
	resolveTheme,
	setTheme,
} from "./theme";

beforeEach(() => {
	document.cookie = `${THEME_COOKIE}=; path=/; max-age=0`;
	document.documentElement.classList.remove("dark", "light");
});

afterEach(() => {
	document.cookie = `${THEME_COOKIE}=; path=/; max-age=0`;
	document.documentElement.classList.remove("dark", "light");
	vi.restoreAllMocks();
});

describe("theme resolution and persistence (#848 Appearance)", () => {
	it("defaults theme choice to dark when cookie is absent", () => {
		expect(getThemeChoice()).toBe("dark");
	});

	it("sets theme choice cookie to system, light, and dark", () => {
		setTheme("system");
		expect(readCookie(THEME_COOKIE)).toBe("system");
		expect(getThemeChoice()).toBe("system");

		setTheme("light");
		expect(readCookie(THEME_COOKIE)).toBe("light");
		expect(getThemeChoice()).toBe("light");

		setTheme("dark");
		expect(readCookie(THEME_COOKIE)).toBe("dark");
		expect(getThemeChoice()).toBe("dark");
	});

	it("resolves system choice from prefers-color-scheme matchMedia", () => {
		expect(resolveTheme("light")).toBe("light");
		expect(resolveTheme("dark")).toBe("dark");

		vi.spyOn(window, "matchMedia").mockImplementation(
			(query: string) =>
				({
					matches: query === SYSTEM_DARK,
					media: query,
					onchange: null,
					addListener: vi.fn(),
					removeListener: vi.fn(),
					addEventListener: vi.fn(),
					removeEventListener: vi.fn(),
					dispatchEvent: vi.fn(),
				}) as unknown as MediaQueryList,
		);

		expect(resolveTheme("system")).toBe("dark");

		vi.spyOn(window, "matchMedia").mockImplementation(
			(query: string) =>
				({
					matches: false,
					media: query,
					onchange: null,
					addListener: vi.fn(),
					removeListener: vi.fn(),
					addEventListener: vi.fn(),
					removeEventListener: vi.fn(),
					dispatchEvent: vi.fn(),
				}) as unknown as MediaQueryList,
		);

		expect(resolveTheme("system")).toBe("light");
	});
});
