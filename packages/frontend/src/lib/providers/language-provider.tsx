// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Language Provider.
 *
 * Client-side only. Paraglide's runtime owns the locale cookie, so the server
 * function that used to double-write it is gone — see `@/lib/locale` for why.
 * Integrates with Paraglide JS for type-safe translations.
 */

import { createContext, type ReactNode, use, useState } from "react";
import { getLocale } from "@/lib/locale";
import {
	type Locale,
	locales,
	setLocale as setParaglideLocale,
} from "@/lib/paraglide/runtime.js";

interface LanguageContextValue {
	locale: Locale;
	setLocale: (locale: Locale) => void;
	availableLocales: readonly Locale[];
}

const LanguageContext = createContext<LanguageContextValue | undefined>(
	undefined,
);

interface LanguageProviderProps {
	children: ReactNode;
}

export function LanguageProvider({ children }: LanguageProviderProps) {
	const [locale, setLocaleState] = useState<Locale>(() => getLocale());

	function setLocale(newLocale: Locale) {
		// Paraglide writes the cookie and re-points its message runtime.
		setParaglideLocale(newLocale, { reload: false });
		setLocaleState(newLocale);
		document.documentElement.lang = newLocale;
	}

	return (
		<LanguageContext value={{ locale, setLocale, availableLocales: locales }}>
			{children}
		</LanguageContext>
	);
}

export function useLanguage() {
	const val = use(LanguageContext);
	if (!val) {
		throw new Error("useLanguage must be used within a LanguageProvider");
	}
	return val;
}
