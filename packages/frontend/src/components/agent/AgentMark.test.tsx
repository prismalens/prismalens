// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	HARNESS_IDS,
	HARNESS_REGISTRY,
	modelMaker,
} from "@prismalens/config/harness";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { BRANDS, brandOf, brandUrl } from "@/assets/brands";
import { AgentMark, MakerMark } from "./AgentMark";

function render(node: React.ReactNode) {
	const host = document.createElement("div");
	act(() => createRoot(host).render(node));
	return host;
}

function drawn(node: React.ReactNode): HTMLElement | null {
	return render(node).firstElementChild as HTMLElement | null;
}

const snapshot = JSON.parse(
	readFileSync(
		join(
			process.cwd(),
			"../@prismalens/config/src/providers/model-makers.json",
		),
		"utf8",
	),
) as { makers: Record<string, unknown> };

const BRAND_DIR = join(process.cwd(), "src/assets/brands");
const art = (file: string) =>
	readFileSync(join(BRAND_DIR, `${file}.svg`), "utf8");

function luminance(hex: string): number {
	const full =
		hex.length === 4
			? `#${hex
					.slice(1)
					.split("")
					.map((c) => c + c)
					.join("")}`
			: hex;
	const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
		const c = Number.parseInt(full.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number, b: number): number {
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The colours an artwork paints with: its fills and gradient stops. */
function colours(svg: string): string[] {
	const named: Record<string, string> = { gold: "#FFD700", white: "#FFFFFF" };
	return Array.from(svg.matchAll(/(?:fill|stop-color)="([^"]+)"/g))
		.map((m) => m[1] ?? "")
		.filter((c) => c !== "none" && !c.startsWith("url("))
		.map((c) => named[c] ?? c);
}

/** A neutral oklch lightness L has luminance L cubed; the marks sit on surface 1 to 3. */
function surfaces(theme: "light" | "dark"): number[] {
	const tokens = readFileSync(
		join(process.cwd(), "src/styles/tokens.css"),
		"utf8",
	);
	return [1, 2, 3].map((n) => {
		const found = (
			tokens.match(
				new RegExp(String.raw`--surface-${n}:\s*oklch\([\d.]+`, "g"),
			) ?? []
		).map((m) => Number(m.replace(/^.*\(/, "")))[theme === "light" ? 0 : 1];
		if (found === undefined)
			throw new Error(`no --surface-${n} for the ${theme} theme`);
		return found ** 3;
	});
}

/** An owner's own colours decide the contrast (its orange on white is 2.7:1); 1.8:1 keeps every mark visible. */
const MIN_CONTRAST = 1.8;
const THEMES = ["light", "dark"] as const;

describe("AgentMark", () => {
	it("draws an agent's logo where one ships, and letters for the rest", () => {
		const lettered = { cursor: "CU", antigravity: "AG", local: "LA" } as Record<
			string,
			string
		>;
		expect(HARNESS_IDS.filter((id) => !brandOf(id))).toEqual([
			"cursor",
			"antigravity",
			"local",
		]);
		expect(HARNESS_IDS.filter((id) => HARNESS_REGISTRY[id].mark)).toEqual([
			"cursor",
			"antigravity",
			"local",
		]);
		const marks = HARNESS_IDS.map((id) => {
			const el = drawn(<AgentMark id={id} />);
			return [
				id,
				el?.getAttribute("data-brand") ?? el?.getAttribute("data-letters"),
			];
		});
		expect(marks).toEqual(
			HARNESS_IDS.map((id) => [id, lettered[id] ?? brandOf(id)?.id]),
		);
	});

	it.each(BRANDS.map((b) => b.id))(
		"draws %s's shipped files as they are: one background per theme, no fill or ink from the theme",
		(id) => {
			const brand = brandOf(id);
			if (!brand) throw new Error(`no brand ${id}`);
			const el = drawn(<MakerMark maker={modelMaker(id)} />) as HTMLElement;
			expect(el.getAttribute("data-testid")).toBe("agent-logo");
			expect(el.getAttribute("data-brand")).toBe(id);
			expect(el.style.getPropertyValue("--logo-light")).toBe(
				`url("${brandUrl(brand, "light")}")`,
			);
			expect(el.style.getPropertyValue("--logo-dark")).toBe(
				`url("${brandUrl(brand, "dark")}")`,
			);
			expect(el.className).toContain("bg-(image:--logo-light)");
			expect(el.className).toContain("dark:bg-(image:--logo-dark)");
			expect(el.className).not.toMatch(/(^|\s)(text-|fill-|\[&_|\[--)/);
		},
	);

	it.each(BRANDS.flatMap((b) => THEMES.map((t) => [b.id, t] as const)))(
		"ships %s's %s file with its own colours, none from the theme's ink",
		(id, theme) => {
			const file = brandOf(id)?.files[theme] ?? "";
			const svg = art(file);
			expect(svg.includes("currentColor"), file).toBe(false);
			expect(colours(svg), file).not.toEqual([]);
		},
	);

	it.each(BRANDS.flatMap((b) => THEMES.map((t) => [b.id, t] as const)))(
		"gives %s a variant legible on the %s theme: a colour at 1.8:1 on surfaces 1 to 3",
		(id, theme) => {
			const lums = colours(art(brandOf(id)?.files[theme] ?? "")).map(luminance);
			const worst = Math.min(
				...surfaces(theme).map((surface) =>
					Math.max(...lums.map((l) => contrast(l, surface))),
				),
			);
			expect(worst).toBeGreaterThanOrEqual(MIN_CONTRAST);
		},
	);

	it("gives a mark that publishes one ink per theme exactly these owners", () => {
		expect(
			BRANDS.filter((b) => b.files.light !== b.files.dark)
				.map((b) => b.id)
				.sort(),
		).toEqual([
			"anthropic",
			"moonshotai",
			"openai",
			"opencode",
			"openrouter",
			"xai",
		]);
	});

	it.each(
		BRANDS.filter((b) => b.files.light !== b.files.dark).map((b) => b.id),
	)("gives %s two files that differ only in their ink", (id) => {
		const { light, dark } = brandOf(id)?.files ?? { light: "", dark: "" };
		const mask = (f: string) =>
			art(f)
				.replace(/#[0-9a-fA-F]{6}/g, "#")
				.replace(/fill-opacity="[^"]+"/g, "");
		expect(mask(light)).toBe(mask(dark));
		expect(art(light)).not.toBe(art(dark));
	});

	it("draws OpenCode at its owner's 16 x 20 minimum", () => {
		const el = drawn(
			<AgentMark id="opencode" className="size-3.5" />,
		) as HTMLElement;
		expect(el.style.minWidth).toBe("16px");
		expect(el.style.minHeight).toBe("20px");
	});

	it.each([...HARNESS_IDS, "unknown-agent"])(
		"hides %s's mark from assistive tech",
		(id) => {
			expect(drawn(<AgentMark id={id} />)?.getAttribute("aria-hidden")).toBe(
				"true",
			);
		},
	);

	it("gives an unknown agent letters from its id, not a generic glyph", () => {
		expect(
			drawn(<AgentMark id="unknown-agent" />)?.getAttribute("data-letters"),
		).toBe("UA");
	});
});

describe("MakerMark", () => {
	it("leaves letters only to the makers with no published logo", () => {
		expect(
			Object.keys(snapshot.makers)
				.filter((id) => !brandOf(id))
				.sort(),
		).toEqual([
			"inclusionai",
			"meituan",
			"recursive",
			"reflection",
			"thinkingmachines",
			"xiaomi",
		]);
	});

	it("tiles a maker with no logo by its snapshot letters", () => {
		expect(
			drawn(<MakerMark maker={modelMaker("xiaomi")} />)?.getAttribute(
				"data-letters",
			),
		).toBe("XI");
	});

	it("draws the logo of a maker that has one", () => {
		expect(
			drawn(<MakerMark maker={modelMaker("zhipuai")} />)?.getAttribute(
				"data-brand",
			),
		).toBe("zhipuai");
	});

	it("tiles an unknown maker with a question mark", () => {
		expect(
			drawn(<MakerMark maker={null} />)?.getAttribute("data-letters"),
		).toBe("?");
	});
});
