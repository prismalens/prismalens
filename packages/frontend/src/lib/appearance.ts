// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useState } from "react";
import { readCookie, writeCookie } from "./theme";

/**
 * The interface font (#848): IBM Plex Sans, the app's own, or the system's.
 * Stored per browser in a cookie like the theme, so the pre-paint script in
 * `__root.tsx` applies it before first paint.
 */
export type InterfaceFont = "plex" | "system";

export const FONT_COOKIE = "prismalens-font";

/** "Segoe UI Variable" alone does not match in Chromium; only the Text cut resolves (#848). */
export const SYSTEM_FONT_STACK =
	'-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, system-ui, sans-serif';

export function getInterfaceFont(): InterfaceFont {
	return readCookie(FONT_COOKIE) === "system" ? "system" : "plex";
}

/** System figures are proportional, so tokens.css sets tabular ones under `data-font`. */
export function applyInterfaceFont(font: InterfaceFont): void {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	if (font === "system") {
		root.style.setProperty("--font-sans", SYSTEM_FONT_STACK);
		root.setAttribute("data-font", "system");
	} else {
		root.style.removeProperty("--font-sans");
		root.removeAttribute("data-font");
	}
}

export function setInterfaceFont(font: InterfaceFont): void {
	writeCookie(FONT_COOKIE, font);
	applyInterfaceFont(font);
}

export function useInterfaceFont(): [
	InterfaceFont,
	(f: InterfaceFont) => void,
] {
	const [font, setFont] = useState<InterfaceFont>(() => getInterfaceFont());
	return [
		font,
		(f) => {
			setInterfaceFont(f);
			setFont(f);
		},
	];
}
