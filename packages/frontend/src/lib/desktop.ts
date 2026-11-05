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
	popup: string | null;
	login: boolean;
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
	/** A native folder pick (#1020); `unavailable` when the server does not read this disk. */
	pickFolder?: () => Promise<
		{ path: string } | { path: null } | { unavailable: true }
	>;
	/** The terminal key the launcher got when it paired (#931); absent in older builds. */
	terminalKey?: () => string | undefined;
	/** Main stored a key it claimed after boot; the listener reads `terminalKey` again. */
	onTerminalKey?: (listener: () => void) => () => void;
}

declare global {
	interface Window {
		prismalensDesktop?: DesktopBridge;
	}
}

/**
 * The desktop title row, `--header-h` and TITLEBAR_HEIGHT in packages/desktop (#1020):
 * floating menus keep below the window controls.
 */
export function titleRowHeight(): number {
	return desktopBridge() ? 44 : 0;
}

export function desktopBridge(): DesktopBridge | undefined {
	return typeof window === "undefined" ? undefined : window.prismalensDesktop;
}
