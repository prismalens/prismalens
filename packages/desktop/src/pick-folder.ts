// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { BrowserWindow, OpenDialogOptions } from "electron";

/** The renderer asks for a native folder pick (#1020); `preload.cts` names it too. */
export const PICK_FOLDER_CHANNEL = "prismalens:pick-folder";

/** What the renderer gets: a path, a cancel, or `unavailable` when the picker would lie. */
export type PickFolderAnswer =
	| { path: string }
	| { path: null }
	| { unavailable: true };

export interface PickFolderDeps {
	showOpenDialog: (
		window: BrowserWindow,
		options: OpenDialogOptions,
	) => Promise<{ canceled: boolean; filePaths: string[] }>;
}

/**
 * A native pick names a folder on this computer, so it is offered only when the server
 * reads the same disk: loopback, and not a WSL server, whose paths differ.
 */
export function pickFolderAvailable(baseUrl: string, inWsl: boolean): boolean {
	if (inWsl || !baseUrl) return false;
	try {
		const host = new URL(baseUrl).hostname;
		return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
	} catch {
		return false;
	}
}

export async function pickFolder(
	deps: PickFolderDeps,
	window: BrowserWindow,
	available: boolean,
): Promise<PickFolderAnswer> {
	if (!available) return { unavailable: true };
	const got = await deps.showOpenDialog(window, {
		properties: ["openDirectory", "createDirectory"],
	});
	const [path] = got.filePaths;
	return got.canceled || !path ? { path: null } : { path };
}
