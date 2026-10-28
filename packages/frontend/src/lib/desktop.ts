// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The run panel's browser as main reports it (`packages/desktop/src/browser-pane.ts`, #973). */
export interface DesktopBrowserState {
	url: string;
	title: string;
	canGoBack: boolean;
	canGoForward: boolean;
	loading: boolean;
	refused: string | null;
}

export interface DesktopBrowser {
	open: (url: string) => void;
	setBounds: (
		rect: { x: number; y: number; width: number; height: number } | null,
	) => void;
	go: (
		to: "back" | "forward" | "reload" | "external" | "state" | "clear",
	) => void;
	/** `null` when the view has not been made yet. */
	onState: (
		listener: (state: DesktopBrowserState | null) => void,
	) => () => void;
}

/** What the Electron preload exposes (`packages/desktop/src/preload.cts`); absent in a browser. */
interface DesktopBridge {
	platform: string;
	setTheme: (theme: "light" | "dark") => void;
	/** Absent in a desktop build from before the panel's browser. */
	browser?: DesktopBrowser;
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
