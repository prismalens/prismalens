// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { KindIcon } from "@/components/settings/source-words";
import { BrandMark, brandMarkId } from "./brand-marks";

function render(node: React.ReactNode) {
	const host = document.createElement("div");
	act(() => createRoot(host).render(node));
	return host;
}

describe("BrandMark", () => {
	it.each([
		"prometheus",
		"github",
		"github-token",
		"gitlab-token",
		"bitbucket",
		"render",
	])("draws a mark for %s, hidden from assistive tech", (id) => {
		const svg = render(<BrandMark id={id} />).querySelector("svg");
		expect(svg?.getAttribute("aria-hidden")).toBe("true");
		expect(svg?.querySelector("path")).not.toBeNull();
	});

	it("paints black brand marks in the theme text color", () => {
		const svg = render(<BrandMark id="github" />).querySelector("svg");
		expect(svg?.getAttribute("fill")).toBe("currentColor");
	});

	it.each(["alertmanager", "loki", "git", "git-host-token"])(
		"has no mark for %s, so the caller keeps its own icon",
		(id) => {
			expect(brandMarkId(id)).toBeUndefined();
			expect(render(<BrandMark id={id} />).querySelector("svg")).toBeNull();
		},
	);

	it("KindIcon shows the vendor mark when there is one and its glyph otherwise", () => {
		expect(
			render(<KindIcon kind="gitlab" />).querySelector("[data-brand-mark]"),
		).not.toBeNull();
		expect(
			render(<KindIcon kind="loki" />).querySelector("[data-brand-mark]"),
		).toBeNull();
	});
});
