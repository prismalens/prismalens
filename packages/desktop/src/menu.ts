// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { MenuItemConstructorOptions } from "electron";

export interface MenuActions {
	openSettings: () => void;
	checkForUpdates: () => void;
}

/**
 * macOS gets a real application menu (#736); elsewhere there is none, since
 * the frame has no menu bar and Chromium keeps the editing shortcuts itself.
 */
export function appMenuTemplate(
	platform: NodeJS.Platform,
	name: string,
	actions: MenuActions,
): MenuItemConstructorOptions[] | null {
	if (platform !== "darwin") return null;
	return [
		{
			label: name,
			submenu: [
				{ role: "about" },
				{ label: "Check for Updates…", click: actions.checkForUpdates },
				{ type: "separator" },
				{
					label: "Settings…",
					accelerator: "Command+,",
					click: actions.openSettings,
				},
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{ role: "quit" },
			],
		},
		{ role: "editMenu" },
		{ role: "windowMenu" },
	];
}
