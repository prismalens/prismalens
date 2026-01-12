/**
 * Locale Server Functions
 *
 * Cookie-based locale management for TanStack Start.
 * Integrates with Paraglide JS for type-safe translations.
 */

import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import {
	baseLocale,
	locales,
	cookieName,
	cookieMaxAge,
	type Locale,
} from "@/lib/paraglide/runtime.js";

export type { Locale };

export const getLocaleServerFn = createServerFn().handler(async () => {
	const cookieLocale = getCookie(cookieName);
	if (cookieLocale && locales.includes(cookieLocale as Locale)) {
		return cookieLocale as Locale;
	}
	return baseLocale;
});

export const setLocaleServerFn = createServerFn({ method: "POST" })
	.inputValidator((d: Locale) => d)
	.handler(async ({ data }) => {
		if (locales.includes(data)) {
			setCookie(cookieName, data, {
				path: "/",
				maxAge: cookieMaxAge,
			});
		}
	});
