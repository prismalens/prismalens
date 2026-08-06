// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Theme persistence — a cookie, read and written on the CLIENT.
 *
 * This used to be a pair of `createServerFn` handlers. They are DELETED, not
 * ported: `pl up` ships a static SPA served by the NestJS API (issue #237), and
 * a server function needs a TanStack Start server that does not exist in that
 * shape — calling one would hit Nest and 404.
 *
 * The job those handlers actually did was avoiding a flash of the wrong theme.
 * That is now the inline pre-paint script in `__root.tsx`, which reads this
 * same cookie and stamps the class on <html> before first paint.
 */

export type Theme = "light" | "dark";

export const THEME_COOKIE = "prismalens-theme";
export const DEFAULT_THEME: Theme = "dark";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Read a cookie value from `document.cookie`; null when absent or prerendering. */
export function readCookie(name: string): string | null {
	if (typeof document === "undefined") return null;
	for (const part of document.cookie.split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key !== name) continue;
		try {
			return decodeURIComponent(rest.join("="));
		} catch {
			// A malformed percent-encoding is someone else's cookie bug; falling
			// back to the default beats throwing during first render.
			return null;
		}
	}
	return null;
}

/** Write a cookie for a year, scoped to the whole app. */
export function writeCookie(name: string, value: string): void {
	if (typeof document === "undefined") return;
	document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

export function getTheme(): Theme {
	return readCookie(THEME_COOKIE) === "light" ? "light" : DEFAULT_THEME;
}

export function setTheme(theme: Theme): void {
	writeCookie(THEME_COOKIE, theme);
	if (typeof document !== "undefined") {
		document.documentElement.classList.toggle("dark", theme === "dark");
		document.documentElement.classList.toggle("light", theme === "light");
	}
}
