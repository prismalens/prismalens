// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Locale persistence — the Paraglide cookie, read on the CLIENT.
 *
 * The `createServerFn` pair that used to live here is DELETED, not ported. See
 * the note in `./theme.ts`: `pl up` serves a static SPA from the NestJS API, so
 * there is no TanStack Start server for a server function to run on.
 *
 * Paraglide's own runtime writes this cookie in `setLocale`; this module only
 * needs to READ it — for the first render, and for the inline pre-paint script
 * in `__root.tsx` that sets <html lang>.
 */

import {
	baseLocale,
	cookieName,
	type Locale,
	locales,
} from "@/lib/paraglide/runtime.js";
import { readCookie } from "./theme";

export type { Locale };
export const LOCALE_COOKIE = cookieName;

export function getLocale(): Locale {
	const value = readCookie(cookieName);
	return value && (locales as readonly string[]).includes(value)
		? (value as Locale)
		: baseLocale;
}
