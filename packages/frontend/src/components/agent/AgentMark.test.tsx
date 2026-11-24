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
import { AgentMark, MakerMark } from "./AgentMark";

function render(node: React.ReactNode) {
	const host = document.createElement("div");
	act(() => createRoot(host).render(node));
	return host;
}

/** The mark's drawn element: a logo's svg inside its tile, else the lettered tile. */
function drawn(node: React.ReactNode): Element | null {
	const host = render(node);
	return (
		host.querySelector("[data-testid=agent-logo]") ?? host.firstElementChild
	);
}

function luminance(hex: string): number {
	const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
		const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number, b: number): number {
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The mark's tile is `bg-surface-4`; a neutral oklch lightness L has luminance L cubed. */
function surface4Luminance(theme: "light" | "dark"): number {
	const tokens = readFileSync(
		join(process.cwd(), "src/styles/tokens.css"),
		"utf8",
	);
	const lightness = (tokens.match(/--surface-4:\s*oklch\([\d.]+/g) ?? []).map(
		(m) => Number(m.replace(/^.*\(/, "")),
	);
	const L = lightness[theme === "light" ? 0 : 1];
	if (L === undefined) throw new Error(`no --surface-4 for the ${theme} theme`);
	return L ** 3;
}

const withLogo = HARNESS_IDS.filter(
	(id) => "logo" in HARNESS_REGISTRY[id].mark,
);

// Every agent draws from its registry `mark` fact, never a generic glyph (#1101).
describe("AgentMark", () => {
	it("draws each agent's logo or its registry letters, and nothing else", () => {
		for (const id of HARNESS_IDS) {
			const mark = HARNESS_REGISTRY[id].mark;
			const el = drawn(<AgentMark id={id} />);
			if ("logo" in mark) {
				expect(el?.getAttribute("data-testid"), id).toBe("agent-logo");
				expect(el?.getAttribute("viewBox"), id).toBe(mark.logo.viewBox);
			} else {
				expect(el?.getAttribute("data-letters"), id).toBe(mark.letters);
			}
		}
	});

	it("draws OpenCode's two-part logo at its 16 x 20 minimum in its own inks", () => {
		const svg = drawn(
			<AgentMark id="opencode" className="size-3.5" />,
		) as SVGElement;
		expect(svg.querySelectorAll("path").length).toBe(2);
		expect(svg.style.width).toBe("16px");
		expect(svg.style.height).toBe("20px");
		expect(svg.style.getPropertyValue("--ink-light")).toBe("#1F1F1F");
		expect(svg.style.getPropertyValue("--ink-dark")).toBe("#EEEEEE");
	});

	it.each(withLogo)(
		"gives %s's logo a form legible on both themes: its tile, and an ink at 3:1 against it",
		(id) => {
			const mark = HARNESS_REGISTRY[id].mark;
			const logo = "logo" in mark ? mark.logo : null;
			expect(
				render(<AgentMark id={id} />).querySelector(
					"[data-testid=agent-logo-tile]",
				)?.className,
			).toContain("bg-surface-4");
			expect(
				contrast(luminance(logo?.ink.light ?? ""), surface4Luminance("light")),
			).toBeGreaterThanOrEqual(3);
			expect(
				contrast(luminance(logo?.ink.dark ?? ""), surface4Luminance("dark")),
			).toBeGreaterThanOrEqual(3);
		},
	);

	it("hides every mark from assistive tech", () => {
		for (const id of [...HARNESS_IDS, "unknown-agent"]) {
			expect(
				drawn(<AgentMark id={id} />)?.getAttribute("aria-hidden"),
				id,
			).toBe("true");
		}
	});

	it("gives an unknown agent letters from its id, not a generic glyph", () => {
		expect(
			drawn(<AgentMark id="unknown-agent" />)?.getAttribute("data-letters"),
		).toBe("UA");
	});
});

describe("MakerMark", () => {
	it("tiles a maker by its snapshot letters", () => {
		expect(
			drawn(<MakerMark maker={modelMaker("zhipuai")} />)?.getAttribute(
				"data-letters",
			),
		).toBe("ZA");
	});

	it("draws the agent's logo for a model its own owner makes", () => {
		expect(
			drawn(<MakerMark maker={modelMaker("opencode")} />)?.getAttribute(
				"data-testid",
			),
		).toBe("agent-logo");
	});

	it("tiles an unknown maker with a question mark", () => {
		expect(
			drawn(<MakerMark maker={null} />)?.getAttribute("data-letters"),
		).toBe("?");
	});
});
