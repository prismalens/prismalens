// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { registerCustomTheme, resolveTheme } from "@pierre/diffs";

/**
 * The syntax themes every diff and file view passes to @pierre/diffs: GitHub's high-contrast pair,
 * the nearest shipped pair to AA on our diff surfaces, with only its failing colours darkened or
 * lightened. e2e/journeys/diff-themes.spec.ts holds each token to AA on every diff surface (#1238).
 */
export const DIFF_THEMES = {
	dark: "prismalens-dark",
	light: "prismalens-light",
} as const;

/** [foreground, its own background or "" for any] -> the foreground that reads at AA there. */
const SWAPS: Record<keyof typeof DIFF_THEMES, [string, string, string][]> = {
	light: [["#66707b", "", "#4b535d"]],
	dark: [
		["#ffffff", "#ff9492", "#0a0c10"],
		["#ffb1af", "#ad0116", "#ffffff"],
		["#ffb757", "#a74c00", "#ffffff"],
	],
};

for (const mode of ["dark", "light"] as const)
	registerCustomTheme(DIFF_THEMES[mode], async () => {
		const base = await resolveTheme(`github-${mode}-high-contrast`);
		const swap = (fg: string | undefined, bg: string | undefined) =>
			SWAPS[mode].find(([f, b]) => f === fg && (b === "" || b === bg))?.[2] ??
			fg;
		return {
			...base,
			name: DIFF_THEMES[mode],
			settings: base.settings.map((r) => ({
				...r,
				settings: {
					...r.settings,
					foreground: swap(r.settings?.foreground, r.settings?.background),
				},
			})),
		};
	});
