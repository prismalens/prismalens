// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// CommonJS and self-contained on purpose: a sandboxed preload can neither be
// an ES module nor require a sibling file. The channel matches `chrome.ts`.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("prismalensDesktop", {
	platform: process.platform,
	setTheme: (theme: "light" | "dark") =>
		ipcRenderer.send("prismalens:theme", theme),
});
