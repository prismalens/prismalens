// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { guessDeviceName, modelFromUserAgent } from "./device-name";

describe("guessDeviceName", () => {
	it.each([
		[
			"Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
			"Firefox on Linux",
		],
		[
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
			"Edge on Windows",
		],
		[
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
			"Safari on macOS",
		],
		[
			"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
			"Safari on iPhone",
		],
		[
			"Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
			"Chrome on Android",
		],
	])("%s", (ua, expected) => {
		expect(guessDeviceName(ua)).toBe(expected);
	});

	it("does not name a VS Code Electron user agent as PrismaLens desktop without the bridge", () => {
		const vscodeUa =
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Code/1.93.1 Chrome/124.0.6367.243 Electron/30.4.0 Safari/537.36";
		expect(guessDeviceName(vscodeUa)).toBe("Chrome on Windows");
	});
	it("names device as PrismaLens desktop when the desktop bridge is present", () => {
		const desktopUa =
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.243 Electron/30.4.0 Safari/537.36";
		expect(guessDeviceName(desktopUa, true)).toBe("PrismaLens desktop on Windows");
	});

	it("identifies desktop app when window.prismalensDesktop is defined on window", () => {
		const desktopUa =
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.243 Electron/30.4.0 Safari/537.36";
		const prevWindow = globalThis.window;
		(globalThis as unknown as { window: unknown }).window = {
			prismalensDesktop: {
				platform: "win32",
				setTheme: () => {},
			},
		};
		try {
			expect(guessDeviceName(desktopUa)).toBe("PrismaLens desktop on Windows");
		} finally {
			(globalThis as unknown as { window: unknown }).window = prevWindow;
		}
	});

	it("is undefined, never empty, for an unknown agent", () => {
		expect(guessDeviceName("curl/8.0")).toBeUndefined();
	});
});

describe("modelFromUserAgent", () => {
	it.each([
		[
			"Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
			"Pixel 9",
		],
		[
			"Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
			undefined,
		],
		[
			"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
			"iPhone",
		],
		[
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
			undefined,
		],
	])("%s", (ua, expected) => {
		expect(modelFromUserAgent(ua)).toBe(expected);
	});
});
