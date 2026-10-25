// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("contrast nudges and 48 px touch targets (#848 case 20)", () => {
	const css = readFileSync(resolve(__dirname, "tokens.css"), "utf8");

	it("nudges text-3, danger, live, ok, and warn text tokens for AA contrast on surface-3", () => {
		// Light theme tokens moved 0.02 to 0.06 L for AA on surface-3
		expect(css).toMatch(/--text-3:\s*oklch\(0\.5\s+0\.012\s+285\);/);
		expect(css).toMatch(/--danger:\s*oklch\(0\.5\s+0\.22\s+27\);/);
		expect(css).toMatch(/--live:\s*oklch\(0\.46\s+0\.11\s+195\);/);
		expect(css).toMatch(/--ok:\s*oklch\(0\.44\s+0\.14\s+160\);/);
		expect(css).toMatch(/--warn:\s*oklch\(0\.47\s+0\.15\s+75\);/);

		// Dark theme text-3 moved from 0.64 to 0.68
		const darkMatch = css.match(/\.dark\s*\{([\s\S]*?)\n\}/);
		expect(darkMatch).not.toBeNull();
		const darkContent = darkMatch ? darkMatch[1] : "";
		expect(darkContent).toMatch(/--text-3:\s*oklch\(0\.68\s+0\.012\s+285\);/);
	});

	it("enforces 48 px minimum height for controls on touch layouts", () => {
		const touchQueryMatch = css.match(
			/@media\s*\(pointer:\s*coarse\),\s*\(max-width:\s*767px\)\s*\{([\s\S]*?)\n\}/,
		);
		expect(touchQueryMatch).not.toBeNull();
		const touchBlock = touchQueryMatch ? touchQueryMatch[1] : "";

		// Header is 48px
		expect(touchBlock).toContain("--header-h: 48px;");

		// Touch target min-height: 48px
		expect(touchBlock).toContain("min-height: 48px;");
		expect(touchBlock).toContain('button:not([role="switch"])');
		expect(touchBlock).toContain('[role="tab"]');
		expect(touchBlock).toContain('[role="radio"]');
		expect(touchBlock).toContain('[role="option"]');
		expect(touchBlock).toContain('[role="menuitem"]');
		expect(touchBlock).toContain('[role="combobox"]');
		expect(touchBlock).toContain("select");
		expect(touchBlock).toContain('input:not([type="checkbox"], [type="radio"], [type="hidden"])');
		expect(touchBlock).toContain("nav a");
		expect(touchBlock).toContain("header a");
	});

	it("gives switches and icon buttons a 48 px hit area without resizing them", () => {
		const hit = css.match(
			/@layer base\s*\{\s*@media\s*\(pointer:\s*coarse\),\s*\(max-width:\s*767px\)\s*\{([\s\S]*?)\n\}/,
		);
		expect(hit).not.toBeNull();
		const block = hit ? hit[1] : "";
		expect(block).toContain('[data-slot="switch"]');
		expect(block).toContain('[data-slot="button"][data-size^="icon"]');
		expect(block).toMatch(/\)::after\s*\{[^}]*width:\s*max\(100%,\s*48px\);/);
		expect(block).toMatch(/\)::after\s*\{[^}]*height:\s*max\(100%,\s*48px\);/);
		expect(block).toContain("position: absolute;");
	});
});
