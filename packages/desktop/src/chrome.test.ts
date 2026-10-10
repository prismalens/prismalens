// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { frameOptions, isTheme, themeFromCookie } from "./chrome.js";

describe("frameOptions", () => {
	it("draws the overlay controls in the theme's colours off macOS", () => {
		for (const platform of ["win32", "linux"] as const) {
			expect(frameOptions(platform, "light")).toEqual({
				titleBarStyle: "hidden",
				backgroundColor: "#fafafa",
				titleBarOverlay: { color: "#eeeef0", symbolColor: "#09090b", height: 40 },
			});
		}
	});

	it("keeps the traffic lights on macOS, with no overlay", () => {
		const options = frameOptions("darwin", "dark");
		expect(options.titleBarOverlay).toBeUndefined();
		expect(options.trafficLightPosition).toEqual({ x: 14, y: 13 });
		expect(options.backgroundColor).toBe("#09090b");
	});
});

describe("theme", () => {
	it("reads the cookie the way the frontend does", () => {
		expect(themeFromCookie("light")).toBe("light");
		expect(themeFromCookie("dark")).toBe("dark");
		expect(themeFromCookie(undefined)).toBe("dark");
		expect(themeFromCookie("solarized")).toBe("dark");
	});

	it("accepts only the two themes over IPC", () => {
		expect(isTheme("light")).toBe(true);
		expect(isTheme("dark")).toBe(true);
		expect(isTheme("#fff")).toBe(false);
		expect(isTheme(undefined)).toBe(false);
	});
});
