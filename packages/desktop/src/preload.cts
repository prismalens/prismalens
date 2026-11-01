// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// CommonJS and self-contained on purpose: a sandboxed preload can neither be
// an ES module nor require a sibling file. The channel matches `chrome.ts`.
import { contextBridge, ipcRenderer } from "electron";

// The browser's channels match `browser.ts` (#973); main checks every sender.
contextBridge.exposeInMainWorld("prismalensDesktop", {
	platform: process.platform,
	setTheme: (theme: "light" | "dark") =>
		ipcRenderer.send("prismalens:theme", theme),
	terminalKey: (): string | undefined =>
		ipcRenderer.sendSync("prismalens:terminal-key") ?? undefined,
	browser: {
		open: (url: string) => ipcRenderer.send("prismalens:browser:open", url),
		setBounds: (
			rect: { x: number; y: number; width: number; height: number } | null,
		) => ipcRenderer.send("prismalens:browser:bounds", rect),
		go: (to: "back" | "forward" | "reload" | "external" | "state" | "clear") =>
			ipcRenderer.send("prismalens:browser:go", to),
		onState: (listener: (state: unknown) => void) => {
			const on = (_e: unknown, state: unknown) => listener(state);
			ipcRenderer.on("prismalens:browser:state", on);
			return () => {
				ipcRenderer.off("prismalens:browser:state", on);
			};
		},
	},
});
