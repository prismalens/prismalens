/**
 * Theme Provider for TanStack Start
 *
 * Server-side theme management using cookies to prevent flicker.
 */

import { createContext, use, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { type Theme, setThemeServerFn } from "@/lib/theme";

interface ThemeContextValue {
	theme: Theme;
	setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
	children: ReactNode;
	theme: Theme;
}

export function ThemeProvider({ children, theme }: ThemeProviderProps) {
	const router = useRouter();

	function setTheme(val: Theme) {
		setThemeServerFn({ data: val }).then(() => router.invalidate());
	}

	return (
		<ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>
	);
}

export function useTheme() {
	const val = use(ThemeContext);
	if (!val) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return val;
}
