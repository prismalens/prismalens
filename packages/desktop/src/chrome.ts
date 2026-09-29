// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The window frame (#736): no OS title bar, the native controls drawn over the
 * app's own 40px strip in the app's colours. The frontend's `--titlebar-h`
 * token must equal `TITLEBAR_HEIGHT`.
 */

import type { BrowserWindowConstructorOptions } from "electron";

export type Theme = "light" | "dark";

export const THEME_CHANNEL = "prismalens:theme";
export const THEME_COOKIE = "prismalens-theme";
export const TITLEBAR_HEIGHT = 40;

/** The frontend's `--background` per theme, as hex. */
const BACKGROUND: Record<Theme, string> = { dark: "#09090b", light: "#fafafa" };
const SYMBOL: Record<Theme, string> = { dark: "#fafafa", light: "#09090b" };

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
		color: BACKGROUND[theme],
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
	// macOS keeps its traffic lights, centred in the strip; the others get the
	// overlay controls, which also keep Windows snap layouts on maximize.
	return platform === "darwin"
		? { ...shared, trafficLightPosition: { x: 14, y: 13 } }
		: { ...shared, titleBarOverlay: titleBarOverlay(theme) };
}
