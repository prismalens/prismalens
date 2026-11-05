// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_IDS } from "@prismalens/config/harness";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { AgentMark } from "./AgentMark";

/** Ids with no mark we may bundle (#1020): they keep a tile on purpose. */
const TILES = ["codex", "deepagents"];
/** Marks come from simple-icons, which the notices pipeline lists from the bundle. */
const MARKED = ["opencode", "claude-code", "gemini"];

function render(id: string) {
	const host = document.createElement("div");
	act(() => createRoot(host).render(<AgentMark id={id} />));
	return host;
}

describe("AgentMark", () => {
	it("gives every known harness id a mark, an explicit tile or the generic icon", () => {
		for (const id of HARNESS_IDS) {
			const host = render(id);
			const tile = host.querySelector('[data-testid="agent-lettermark"]');
			if (MARKED.includes(id)) {
				expect(host.querySelector("svg path"), id).not.toBeNull();
				expect(tile, id).toBeNull();
			} else if (TILES.includes(id)) {
				expect(tile, id).not.toBeNull();
			} else {
				expect(id).toBe("local");
				expect(host.querySelector("svg"), id).not.toBeNull();
			}
		}
	});

	it("hides every mark from assistive tech", () => {
		for (const id of [...HARNESS_IDS, "unknown-agent"]) {
			expect(render(id).firstElementChild?.getAttribute("aria-hidden")).toBe(
				"true",
			);
		}
	});

	it("paints opencode in the theme text color, not its black brand color", () => {
		const svg = render("opencode").querySelector("svg");
		expect(svg?.getAttribute("fill")).toBe("currentColor");
	});

	it("falls back to the generic icon for an unknown id", () => {
		expect(render("unknown-agent").querySelector("svg")).not.toBeNull();
	});
});
