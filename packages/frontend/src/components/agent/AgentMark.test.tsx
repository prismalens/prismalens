// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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

// Every agent draws from its registry `mark` fact, never a generic glyph (#1101).
describe("AgentMark", () => {
	it("draws each agent's logo or its registry letters, and nothing else", () => {
		for (const id of HARNESS_IDS) {
			const mark = HARNESS_REGISTRY[id].mark;
			const el = render(<AgentMark id={id} />).firstElementChild;
			if ("logo" in mark) {
				expect(el?.getAttribute("data-testid"), id).toBe("agent-logo");
				expect(el?.getAttribute("viewBox"), id).toBe(mark.logo.viewBox);
			} else {
				expect(el?.getAttribute("data-letters"), id).toBe(mark.letters);
			}
		}
	});

	it("draws OpenCode's two-part logo at its 16 x 20 minimum in its own inks", () => {
		const svg = render(<AgentMark id="opencode" className="size-3.5" />)
			.firstElementChild as SVGElement;
		expect(svg.querySelectorAll("path").length).toBe(2);
		expect(svg.style.width).toBe("16px");
		expect(svg.style.height).toBe("20px");
		expect(svg.style.getPropertyValue("--ink-light")).toBe("#1F1F1F");
		expect(svg.style.getPropertyValue("--ink-dark")).toBe("#EEEEEE");
	});

	it("hides every mark from assistive tech", () => {
		for (const id of [...HARNESS_IDS, "unknown-agent"]) {
			expect(
				render(<AgentMark id={id} />).firstElementChild?.getAttribute(
					"aria-hidden",
				),
			).toBe("true");
		}
	});

	it("gives an unknown agent letters from its id, not a generic glyph", () => {
		expect(
			render(<AgentMark id="unknown-agent" />).firstElementChild?.getAttribute(
				"data-letters",
			),
		).toBe("UA");
	});
});

describe("MakerMark", () => {
	it("tiles a maker by its snapshot letters", () => {
		expect(
			render(
				<MakerMark maker={modelMaker("zhipuai")} />,
			).firstElementChild?.getAttribute("data-letters"),
		).toBe("ZA");
	});

	it("draws the agent's logo for a model its own owner makes", () => {
		expect(
			render(
				<MakerMark maker={modelMaker("opencode")} />,
			).firstElementChild?.getAttribute("data-testid"),
		).toBe("agent-logo");
	});

	it("tiles an unknown maker with a question mark", () => {
		expect(
			render(<MakerMark maker={null} />).firstElementChild?.getAttribute(
				"data-letters",
			),
		).toBe("?");
	});
});
