/**
 * Theme Server Functions
 *
 * Cookie-based theme management for TanStack Start.
 * Prevents flash of unstyled content (FOUC) by handling theme on the server.
 */

import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";

export type Theme = "light" | "dark";

const STORAGE_KEY = "prismalens-theme";

export const getThemeServerFn = createServerFn().handler(
	async () => (getCookie(STORAGE_KEY) || "dark") as Theme,
);

export const setThemeServerFn = createServerFn({ method: "POST" })
	.inputValidator((d: Theme) => d)
	.handler(async ({ data }) => {
		setCookie(STORAGE_KEY, data, {
			path: "/",
			maxAge: 60 * 60 * 24 * 365, // 1 year
		});
	});
