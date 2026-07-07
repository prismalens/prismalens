// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Language Provider for TanStack Start
 *
 * Server-side locale management using cookies for SSR.
 * Integrates with Paraglide JS for type-safe translations.
 */

import { useRouter } from "@tanstack/react-router";
import { createContext, type ReactNode, use } from "react";
import { setLocaleServerFn } from "@/lib/locale";
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
	locale: Locale;
}

export function LanguageProvider({ children, locale }: LanguageProviderProps) {
	const router = useRouter();

	function setLocale(newLocale: Locale) {
		// Set locale in Paraglide runtime (updates cookie on client)
		setParaglideLocale(newLocale, { reload: false });
		// Also update server cookie and invalidate router
		setLocaleServerFn({ data: newLocale }).then(() => router.invalidate());
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
