// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type BrowserWindow,
	type Event,
	ipcMain,
	session,
	shell,
	WebContentsView,
} from "electron";
import {
	BROWSER_CHANNEL,
	BROWSER_PARTITION,
	browserUrl,
	browserWebPreferences,
	clampBounds,
	isAppOrigin,
	isGo,
	trustedSender,
} from "./browser.js";

export interface BrowserState {
	url: string;
	title: string;
	canGoBack: boolean;
	canGoForward: boolean;
	loading: boolean;
	/** Set when a navigation was refused, with the address that was. */
	refused: string | null;
}

/** The app window never leaves the backend's origin: the preload's bridge is only for it (#973). */
export function guardAppWindow(window: BrowserWindow, app: () => string) {
	window.webContents.on("will-navigate", (event, url) => {
		if (isAppOrigin(url, app())) return;
		event.preventDefault();
		if (browserUrl(url)) void shell.openExternal(url);
	});
}

let locked = false;

/** The browser session refuses every permission and download, once per app (#973). */
function lockSession() {
	if (locked) return;
	locked = true;
	const s = session.fromPartition(BROWSER_PARTITION);
	s.setPermissionRequestHandler((_wc, _permission, callback) =>
		callback(false),
	);
	s.setPermissionCheckHandler(() => false);
	s.setDevicePermissionHandler(() => false);
	s.on("will-download", (event) => event.preventDefault());
}

/**
 * One view per app window, made on first use, laid over the rect the panel
 * reports and hidden whenever it reports none. `app` reads the backend's
 * current origin: only that origin's top frame may drive it.
 */
export function attachBrowser(
	window: BrowserWindow,
	app: () => string,
	packaged: boolean,
): () => void {
	let view: WebContentsView | null = null;
	let refused: string | null = null;

	const send = () => {
		if (!view || window.isDestroyed()) return;
		const wc = view.webContents;
		const state: BrowserState = {
			url: wc.getURL(),
			title: wc.getTitle(),
			canGoBack: wc.navigationHistory.canGoBack(),
			canGoForward: wc.navigationHistory.canGoForward(),
			loading: wc.isLoading(),
			refused,
		};
		window.webContents.send(BROWSER_CHANNEL.state, state);
	};

	const guard = (event: Event, url: string) => {
		if (browserUrl(url)) return;
		event.preventDefault();
		refused = url;
		send();
	};

	const make = () => {
		lockSession();
		const v = new WebContentsView({
			webPreferences: browserWebPreferences(packaged),
		});
		v.setVisible(false);
		const wc = v.webContents;
		// A page never opens a window or leaves http(s): popups go to the system browser.
		wc.setWindowOpenHandler(({ url }) => {
			if (browserUrl(url)) void shell.openExternal(url);
			return { action: "deny" };
		});
		wc.on("will-navigate", guard);
		wc.on("will-redirect", guard);
		wc.on("will-frame-navigate", (event) => guard(event, event.url));
		wc.on("will-attach-webview", (event) => event.preventDefault());
		for (const e of [
			"did-start-loading",
			"did-stop-loading",
			"did-navigate",
			"did-navigate-in-page",
			"page-title-updated",
		] as const)
			wc.on(e as "did-stop-loading", send);
		window.contentView.addChildView(v);
		return v;
	};

	const trusted = (event: Electron.IpcMainEvent) =>
		trustedSender(event, window.webContents, app());

	const onOpen = (event: Electron.IpcMainEvent, raw: unknown) => {
		if (!trusted(event) || typeof raw !== "string") return;
		const url = browserUrl(raw);
		refused = url ? null : raw;
		if (!url) return send();
		view ??= make();
		void view.webContents.loadURL(url.href).catch(() => send());
	};
	const onBounds = (event: Electron.IpcMainEvent, rect: unknown) => {
		if (!trusted(event) || !view) return;
		const [width, height] = window.getContentSize() as [number, number];
		const bounds = clampBounds(rect, { width, height });
		if (bounds) view.setBounds(bounds);
		view.setVisible(!!bounds);
	};
	const onGo = (event: Electron.IpcMainEvent, go: unknown) => {
		if (!trusted(event) || !view || !isGo(go)) return;
		const wc = view.webContents;
		if (go === "back") wc.navigationHistory.goBack();
		else if (go === "forward") wc.navigationHistory.goForward();
		else if (go === "reload") wc.reload();
		else if (browserUrl(wc.getURL())) void shell.openExternal(wc.getURL());
	};

	ipcMain.on(BROWSER_CHANNEL.open, onOpen);
	ipcMain.on(BROWSER_CHANNEL.bounds, onBounds);
	ipcMain.on(BROWSER_CHANNEL.go, onGo);
	const detach = () => {
		ipcMain.off(BROWSER_CHANNEL.open, onOpen);
		ipcMain.off(BROWSER_CHANNEL.bounds, onBounds);
		ipcMain.off(BROWSER_CHANNEL.go, onGo);
		if (view && !view.webContents.isDestroyed()) view.webContents.close();
		view = null;
	};
	window.on("closed", detach);
	// A reload or another page in the window drops the view until it is asked for again.
	window.webContents.on("did-start-navigation", (details) => {
		if (details.isMainFrame && !details.isSameDocument) view?.setVisible(false);
	});
	return detach;
}
