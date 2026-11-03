// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The window frame (#736): no OS title bar; the native controls sit on the
 * app's own title row, the brand row and page header (#1020), in its colours.
 * `TITLEBAR_HEIGHT` must equal the frontend's `--header-h`.
 */

import type { BrowserWindowConstructorOptions } from "electron";

export type Theme = "light" | "dark";

export const THEME_CHANNEL = "prismalens:theme";
/** The renderer asks for the terminal key (#931); `preload.cts` names it too. */
export const TERMINAL_KEY_CHANNEL = "prismalens:terminal-key";
/** Main tells the renderer a late claim stored the key; `preload.cts` names it too. */
export const TERMINAL_KEY_CHANGED_CHANNEL = "prismalens:terminal-key-changed";
export const THEME_COOKIE = "prismalens-theme";
export const TITLEBAR_HEIGHT = 44;

/** The frontend's `--background` per theme, as hex. */
const BACKGROUND: Record<Theme, string> = { dark: "#09090b", light: "#fafafa" };
const SYMBOL: Record<Theme, string> = { dark: "#fafafa", light: "#09090b" };
/** The title row the controls sit on: the frontend's `--surface-1`, as hex. */
const STRIP: Record<Theme, string> = { dark: "#161618", light: "#eeeef0" };

/** Same rule as the frontend's pre-paint script: anything but `light` is dark. */
export function themeFromCookie(value: string | undefined): Theme {
	return value === "light" ? "light" : "dark";
}

export function isTheme(value: unknown): value is Theme {
	return value === "light" || value === "dark";
}

export function backgroundColor(theme: Theme): string {
	return BACKGROUND[theme];
}

export function titleBarOverlay(theme: Theme) {
	return {
		color: STRIP[theme],
		symbolColor: SYMBOL[theme],
		height: TITLEBAR_HEIGHT,
	};
}

export function frameOptions(
	platform: NodeJS.Platform,
	theme: Theme,
): BrowserWindowConstructorOptions {
	const shared = {
		titleBarStyle: "hidden" as const,
		backgroundColor: backgroundColor(theme),
	};
	// macOS keeps its traffic lights (14px tall), centred in the row; the others
	// get the overlay controls, which also keep Windows snap layouts on maximize.
	return platform === "darwin"
		? {
				...shared,
				trafficLightPosition: { x: 14, y: (TITLEBAR_HEIGHT - 14) / 2 },
			}
		: { ...shared, titleBarOverlay: titleBarOverlay(theme) };
}
