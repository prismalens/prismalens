// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The window shown at once while the backend starts (#875). */

import type { Theme } from "./chrome.js";
import { backgroundColor } from "./chrome.js";

const INK: Record<Theme, string> = { dark: "#fafafa", light: "#09090b" };

/** A self-contained page: no network, the brand mark inlined as a data URL. */
export function splashHtml(theme: Theme, iconDataUrl: string): string {
	return `<!doctype html><meta charset="utf-8"><title>PrismaLens</title>
<style>html,body{height:100%;margin:0;background:${backgroundColor(theme)};color:${INK[theme]};
font:15px system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;
justify-content:center;gap:16px;-webkit-app-region:drag;user-select:none}
img{width:72px;height:72px}</style>
<img src="${iconDataUrl}" alt=""><div>Starting…</div>`;
}

export type Splash = { close(): void };

export type StartupDeps = {
	showSplash(): Splash;
	boot(): Promise<void>;
	/** Opens the main window; the splash closes on its first `ready-to-show`. */
	openMain(onFirstShow: () => void): void;
	refuse(error: unknown): Promise<void>;
};

/** Splash first, then the backend, then the main window; a failure drops the splash for the error path. */
export async function startWithSplash(deps: StartupDeps): Promise<void> {
	const splash = deps.showSplash();
	try {
		await deps.boot();
		deps.openMain(() => splash.close());
	} catch (error) {
		splash.close();
		await deps.refuse(error);
	}
}
