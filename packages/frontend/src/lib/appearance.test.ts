// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	FONT_COOKIE,
	SYSTEM_FONT_STACK,
	applyInterfaceFont,
	getInterfaceFont,
	setInterfaceFont,
} from "./appearance";
import { readCookie } from "./theme";

beforeEach(() => {
	document.cookie = `${FONT_COOKIE}=; path=/; max-age=0`;
	document.documentElement.style.removeProperty("--font-sans");
	document.documentElement.removeAttribute("data-font");
});

afterEach(() => {
	document.cookie = `${FONT_COOKIE}=; path=/; max-age=0`;
	document.documentElement.style.removeProperty("--font-sans");
	document.documentElement.removeAttribute("data-font");
});

describe("interface font (case 3)", () => {
	it("uses IBM Plex Sans by default with no cookie and no inline styles", () => {
		expect(getInterfaceFont()).toBe("plex");
		expect(readCookie(FONT_COOKIE)).toBeNull();
		expect(
			document.documentElement.style.getPropertyValue("--font-sans"),
		).toBe("");
		expect(document.documentElement.hasAttribute("data-font")).toBe(false);
	});

	it("sets system font stack, data-font, and cookie when system is chosen", () => {
		setInterfaceFont("system");
		expect(getInterfaceFont()).toBe("system");
		expect(readCookie(FONT_COOKIE)).toBe("system");
		expect(
			document.documentElement.style.getPropertyValue("--font-sans"),
		).toBe(
			'-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, system-ui, sans-serif',
		);
		expect(document.documentElement.getAttribute("data-font")).toBe("system");
	});

	it("removes inline font-sans and data-font when switching back to plex", () => {
		setInterfaceFont("system");
		setInterfaceFont("plex");
		expect(getInterfaceFont()).toBe("plex");
		expect(
			document.documentElement.style.getPropertyValue("--font-sans"),
		).toBe("");
		expect(document.documentElement.hasAttribute("data-font")).toBe(false);
	});

	it("PRE_PAINT in __root.tsx includes font cookie and system font stack", () => {
		const rootPath = join(process.cwd(), "src/routes/__root.tsx");
		const rootSrc = readFileSync(rootPath, "utf8");
		expect(rootSrc).toContain("FONT_COOKIE");
		expect(rootSrc).toContain("SYSTEM_FONT_STACK");
		expect(rootSrc).toContain("--font-sans");
	});
});
