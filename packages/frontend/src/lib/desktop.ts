// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** What the Electron preload exposes (`packages/desktop/src/preload.cts`); absent in a browser. */
interface DesktopBridge {
	platform: string;
	setTheme: (theme: "light" | "dark") => void;
}

declare global {
	interface Window {
		prismalensDesktop?: DesktopBridge;
	}
}

/** `--titlebar-h` in the desktop window (#819): floating menus keep below the window controls. */
export function titleRowHeight(): number {
	return desktopBridge() ? 32 : 0;
}

export function desktopBridge(): DesktopBridge | undefined {
	return typeof window === "undefined" ? undefined : window.prismalensDesktop;
}
