// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { appMenuTemplate } from "./menu.js";

const actions = { openSettings: vi.fn(), checkForUpdates: vi.fn() };

describe("appMenuTemplate", () => {
	it("has no menu off macOS", () => {
		expect(appMenuTemplate("win32", "PrismaLens", actions)).toBeNull();
		expect(appMenuTemplate("linux", "PrismaLens", actions)).toBeNull();
	});

	it("puts Settings on Command+, and keeps Edit for copy and paste on macOS", () => {
		const template = appMenuTemplate("darwin", "PrismaLens", actions) ?? [];
		const app = template[0];
		const items = Array.isArray(app?.submenu) ? app.submenu : [];
		const settings = items.find((i) => i.label === "Settings…");
		expect(settings?.accelerator).toBe("Command+,");
		settings?.click?.({} as never, undefined, {} as never);
		expect(actions.openSettings).toHaveBeenCalled();
		expect(template.some((m) => m.role === "editMenu")).toBe(true);
	});
});
