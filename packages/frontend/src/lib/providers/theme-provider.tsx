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
import { getTheme, setTheme as persistTheme, type Theme } from "@/lib/theme";

interface ThemeContextValue {
	theme: Theme;
	setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
	children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
	const [theme, setThemeState] = useState<Theme>(() => getTheme());

	// Re-assert the class after hydration: the prerendered shell carries the
	// default, and React does not patch a mismatched attribute it was told to
	// ignore. The pre-paint script already got this right for first paint; this
	// keeps the two in step if React ever re-renders <html>.
	useEffect(() => {
		document.documentElement.classList.toggle("dark", theme === "dark");
		document.documentElement.classList.toggle("light", theme === "light");
	}, [theme]);

	function setTheme(val: Theme) {
		persistTheme(val);
		setThemeState(val);
	}

	return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>;
}

export function useTheme() {
	const val = use(ThemeContext);
	if (!val) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return val;
}
