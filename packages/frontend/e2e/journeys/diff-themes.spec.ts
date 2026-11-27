// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { resolveTheme } from "@pierre/diffs";
import { expect, type Page, test } from "@playwright/test";
import { DIFF_THEMES } from "../../src/components/thread/diff/diff-themes";

// Every syntax colour the diff themes can draw must read at AA (4.5:1) on each background a diff
// line takes: the plain line, the context and gap rows, added and removed lines, and their word
// marks (@pierre/diffs style.js), plus the file view's surface-1 (#1238).
const MIX = {
	light: { mixer: "#000", context: 98.5, line: 88, mark: 0.15 },
	dark: { mixer: "#fff", context: 92.5, line: 80, mark: 0.2 },
} as const;
const tokens = readFileSync("src/styles/tokens.css", "utf8");
const surface1 = [...tokens.matchAll(/--surface-1: (oklch\([^)]*\));/g)].map(
	(m) => m[1],
);
const SURFACE_1 = { light: surface1[0], dark: surface1[1] };

type Rgb = [number, number, number];
const luminance = ([r, g, b]: Rgb) => {
	const c = [r, g, b].map((v) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
};
const contrast = (a: Rgb, b: Rgb) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

/** Paints each CSS colour, composited in order over the previous one, and reads back sRGB. */
async function paint(page: Page, layers: string[][]): Promise<Rgb[]> {
	return page.evaluate((stacks) => {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 1;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) throw new Error("no 2d canvas");
		return stacks.map((stack) => {
			ctx.clearRect(0, 0, 1, 1);
			for (const color of stack) {
				ctx.fillStyle = color;
				ctx.fillRect(0, 0, 1, 1);
			}
			const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
			return [r ?? 0, g ?? 0, b ?? 0] as [number, number, number];
		});
	}, layers);
}

/** Every token colour of `mode`'s theme, on every surface a diff line takes there, below AA. */
async function failures(page: Page, mode: "light" | "dark"): Promise<string[]> {
	const theme = await resolveTheme(DIFF_THEMES[mode]);
	const colors = (theme.colors ?? {}) as Record<string, string>;
	const bg = theme.bg ?? colors["editor.background"] ?? "#fff";
	const add =
		colors["gitDecoration.addedResourceForeground"] ??
		colors["terminal.ansiGreen"] ??
		"#0dbe4e";
	const del =
		colors["gitDecoration.deletedResourceForeground"] ??
		colors["terminal.ansiRed"] ??
		"#ff2e3f";
	const m = MIX[mode];
	const mix = (base: string, pct: number, other: string) =>
		`color-mix(in lab, ${base} ${pct}%, ${other})`;
	const mark = (base: string) => `rgb(from ${base} r g b / ${m.mark})`;
	const surfaces: Record<string, string[]> = {
		line: [bg],
		context: [mix(bg, m.context, m.mixer)],
		added: [mix(bg, m.line, add)],
		removed: [mix(bg, m.line, del)],
		"added word": [mix(bg, m.line, add), mark(add)],
		"removed word": [mix(bg, m.line, del), mark(del)],
		"file view": [SURFACE_1[mode] ?? bg],
	};
	// A resolved theme keeps its rules in `settings`. A scoped rule with its own background draws on
	// it, not on the line; the scope-less rule is the line's own default.
	const rules = (theme.settings ?? theme.tokenColors ?? [])
		.map((r) => ({
			fg: r.settings?.foreground,
			own: r.scope ? r.settings?.background : undefined,
			scope: String(r.scope ?? r.name ?? "default"),
		}))
		.filter(
			(r): r is { fg: string; own: string | undefined; scope: string } =>
				typeof r.fg === "string",
		);
	const plain = [
		{
			fg: theme.fg ?? colors["editor.foreground"] ?? "#000",
			own: undefined,
			scope: "text",
		},
		...rules,
	];
	if (plain.length <= 20)
		throw new Error(`${DIFF_THEMES[mode]} resolved with ${plain.length} rules`);
	const fails: string[] = [];
	const names = Object.keys(surfaces);
	const painted = await paint(
		page,
		names.map((n) => surfaces[n] ?? []),
	);
	for (const r of plain) {
		const [fg] = await paint(page, [[r.own ?? bg, r.fg]]);
		const backs = r.own ? await paint(page, [[r.own]]) : painted;
		backs.forEach((back, i) => {
			const ratio = contrast(fg ?? [0, 0, 0], back);
			if (ratio < 4.5)
				fails.push(
					`${r.scope.slice(0, 40)} ${r.fg} on ${r.own ? "its own bg" : names[i]}: ${ratio.toFixed(2)}`,
				);
		});
	}
	return fails;
}

test("each light diff token reads at AA on every diff surface (#1238)", async ({
	page,
}) => {
	expect(await failures(page, "light"), DIFF_THEMES.light).toEqual([]);
});

test("each dark diff token reads at AA on every diff surface (#1238)", async ({
	page,
}) => {
	expect(await failures(page, "dark"), DIFF_THEMES.dark).toEqual([]);
});
