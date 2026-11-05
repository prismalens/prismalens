// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import { pickFolder, pickFolderAvailable } from "./pick-folder.js";

const win = {} as BrowserWindow;

describe("the native folder pick (#1020)", () => {
	it("is offered only for a loopback server that is not in WSL", () => {
		expect(pickFolderAvailable("http://127.0.0.1:6473", false)).toBe(true);
		expect(pickFolderAvailable("http://localhost:6473", false)).toBe(true);
		expect(pickFolderAvailable("http://127.0.0.1:6473", true)).toBe(false);
		expect(pickFolderAvailable("https://pl.example.com", false)).toBe(false);
		expect(pickFolderAvailable("", false)).toBe(false);
		expect(pickFolderAvailable("not a url", false)).toBe(false);
	});

	it("asks for a folder the user may also create, and returns the pick", async () => {
		const showOpenDialog = vi.fn(async () => ({
			canceled: false,
			filePaths: ["C:\\code\\notes"],
		}));
		expect(await pickFolder({ showOpenDialog }, win, true)).toEqual({
			path: "C:\\code\\notes",
		});
		expect(showOpenDialog).toHaveBeenCalledWith(win, {
			properties: ["openDirectory", "createDirectory"],
		});
	});

	it("a cancel returns no path; an unavailable pick never opens the dialog", async () => {
		const showOpenDialog = vi.fn(async () => ({
			canceled: true,
			filePaths: [],
		}));
		expect(await pickFolder({ showOpenDialog }, win, true)).toEqual({
			path: null,
		});
		showOpenDialog.mockClear();
		expect(await pickFolder({ showOpenDialog }, win, false)).toEqual({
			unavailable: true,
		});
		expect(showOpenDialog).not.toHaveBeenCalled();
	});
});
