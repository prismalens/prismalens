/**
 * Language Provider for TanStack Start
 *
 * Server-side locale management using cookies for SSR.
 * Integrates with Paraglide JS for type-safe translations.
 */

import { createContext, use, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import {
	locales,
	setLocale as setParaglideLocale,
	type Locale,
} from "@/lib/paraglide/runtime.js";
import { setLocaleServerFn } from "@/lib/locale";

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
