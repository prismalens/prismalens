// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it } from "vitest";
import { markTitleRowEdges } from "./title-row";

const row = (box: { left: number; right: number; top: number }) => {
	const el = document.createElement("div");
	el.setAttribute("data-title-row", "");
	el.getBoundingClientRect = () =>
		({ ...box, height: 44, width: box.right - box.left }) as DOMRect;
	document.body.append(el);
	return el;
};

describe("markTitleRowEdges (#1020)", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it("pads only the row the window controls reach, by the width they cover", () => {
		const width = window.innerWidth;
		const brand = row({ left: 0, right: 240, top: 0 });
		const header = row({ left: 240, right: width, top: 0 });
		const below = row({ left: 240, right: width, top: 600 });
		markTitleRowEdges(document, 44, { left: 0, right: 138 });
		expect(header.hasAttribute("data-edge-right")).toBe(true);
		expect(header.style.getPropertyValue("--edge-right")).toBe("138px");
		expect(brand.hasAttribute("data-edge-right")).toBe(false);
		expect(brand.hasAttribute("data-edge-left")).toBe(false);
		expect(below.hasAttribute("data-edge-right")).toBe(false);
	});

	it("covers macOS's traffic lights on the left, past a narrow rail", () => {
		const rail = row({ left: 0, right: 56, top: 0 });
		const header = row({ left: 56, right: 900, top: 0 });
		markTitleRowEdges(document, 44, { left: 80, right: 0 });
		expect(rail.style.getPropertyValue("--edge-left")).toBe("80px");
		expect(rail.hasAttribute("data-edge-covered")).toBe(true);
		expect(header.hasAttribute("data-edge-covered")).toBe(false);
		expect(header.style.getPropertyValue("--edge-left")).toBe("24px");
		expect(header.hasAttribute("data-edge-right")).toBe(false);
	});

	it("clears a mark once the row moves away from the controls", () => {
		const width = window.innerWidth;
		const header = row({ left: 240, right: width, top: 0 });
		markTitleRowEdges(document, 44, { left: 0, right: 138 });
		header.getBoundingClientRect = () =>
			({ left: 240, right: width - 420, top: 0, height: 44 }) as DOMRect;
		markTitleRowEdges(document, 44, { left: 0, right: 138 });
		expect(header.hasAttribute("data-edge-right")).toBe(false);
		expect(header.style.getPropertyValue("--edge-right")).toBe("");
	});
});
