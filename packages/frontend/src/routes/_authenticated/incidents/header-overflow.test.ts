// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * f5: at 360px the toolbar row overflowed. Jsdom does not evaluate media
 * queries, so this checks the Tailwind classes that produce the wrap/hide
 * behavior are present, rather than rendering the whole router-bound route.
 */
const source = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "index.tsx"),
	"utf8",
);

describe("incidents board header overflow (f5)", () => {
	it("lets the toolbar row wrap below sm and stay on one line at sm and up", () => {
		expect(source).toMatch(/flex-wrap[^"]*border-b px-4/);
		expect(source).toMatch(/sm:flex-nowrap/);
	});

	it("puts filter and window controls on their own row below sm", () => {
		expect(source).toMatch(/className="flex w-full items-center gap-1 sm:ml-auto sm:w-auto"/);
	});

	it("hides the keyboard hint on touch pointers and below md", () => {
		expect(source).toMatch(/jump to a column/);
		expect(source).toMatch(/hidden items-center gap-1 pointer-fine:md:flex/);
	});
});
