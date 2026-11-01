// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Theme Provider.
 *
 * Client-side only. The theme lives in a cookie, and the inline pre-paint
 * script in `__root.tsx` has already stamped the class on <html> before React
 * runs — so there is no flicker, and nothing for a server to do. See
 * `@/lib/theme` for why the server functions were deleted.
 */

import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { desktopBridge } from "@/lib/desktop";
import {
	applyTheme,
	getThemeChoice,
	setTheme as persistTheme,
	resolveTheme,
	SYSTEM_DARK,
	type Theme,
	type ThemeChoice,
} from "@/lib/theme";

interface ThemeContextValue {
	/** What shows now. */
	theme: Theme;
	/** What Appearance stores: a theme, or the OS's (#848). */
	choice: ThemeChoice;
	setTheme: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
	children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
	const [choice, setChoice] = useState<ThemeChoice>(() => getThemeChoice());
	const [theme, setThemeState] = useState<Theme>(() => resolveTheme(choice));

	// Re-assert the class after hydration: the prerendered shell carries the
	// default, and React does not patch a mismatched attribute it was told to
	// ignore. The pre-paint script already got this right for first paint; this
	// keeps the two in step if React ever re-renders <html>.
	useEffect(() => {
		applyTheme(theme);
		const desktop = desktopBridge();
		if (desktop) {
			document.documentElement.dataset.desktop = desktop.platform;
			desktop.setTheme(theme);
		}
	}, [theme]);

	// System follows the OS while the page is open.
	useEffect(() => {
		if (choice !== "system") return;
		const mql = window.matchMedia(SYSTEM_DARK);
		const onChange = () => setThemeState(resolveTheme("system"));
		mql.addEventListener("change", onChange);
		return () => mql.removeEventListener("change", onChange);
	}, [choice]);

	function setTheme(val: ThemeChoice) {
		persistTheme(val);
		setChoice(val);
		setThemeState(resolveTheme(val));
	}

	return (
		<ThemeContext value={{ theme, choice, setTheme }}>{children}</ThemeContext>
	);
}

export function useTheme() {
	const val = use(ThemeContext);
	if (!val) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return val;
}
