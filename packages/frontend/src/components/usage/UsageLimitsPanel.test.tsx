// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { UsageLimits } from "@prismalens/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageLimitsPanel } from "./UsageLimitsPanel";

vi.mock("@/lib/api/hooks/use-usage-orpc", () => ({
	useUsageLimits: () => ({ data: undefined }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

describe("UsageLimitsPanel empty agents (#1171)", () => {
	it("says an agent shows after a run, or that it does not report", async () => {
		const limits: UsageLimits = {
			agents: [
				{ agent: "claude-code", windows: [], empty: "no-run-yet" },
				{ agent: "codex", windows: [], empty: "not-reported" },
			],
		};
		await act(async () => {
			root.render(<UsageLimitsPanel limits={limits} now={Date.now()} />);
		});
		const text = (agent: string) =>
			container.querySelector(`[data-testid="limits-empty-${agent}"]`)
				?.textContent;
		expect(text("claude-code")).toBe("Shows after a run");
		expect(text("codex")).toBe("Not reported");
	});
});
