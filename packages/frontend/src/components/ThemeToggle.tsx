// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Moon, Sun } from "lucide-react";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/providers/theme-provider";

/** Flips between the dark and the light theme. */
export function ThemeToggle() {
	const { theme, setTheme } = useTheme();
	const next = theme === "dark" ? "light" : "dark";
	return (
		<Hint label={next === "light" ? "Light theme" : "Dark theme"} side="right">
			<Button
				variant="ghost"
				size="icon"
				onClick={() => setTheme(next)}
				// One name in both themes: the prerendered shell is dark, so a theme-dependent name fails hydration.
				aria-label="Switch theme"
				data-testid="theme-toggle"
			>
				{/* CSS picks the icon: the prerendered shell cannot know the cookie. */}
				<Sun className="size-4 dark:hidden" />
				<Moon className="hidden size-4 dark:block" />
			</Button>
		</Hint>
	);
}
