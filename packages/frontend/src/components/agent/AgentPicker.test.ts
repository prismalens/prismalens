// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentModelPicker } from "./AgentPicker";

let mockHarnessesData = {
	harnesses: [
		{
			id: "opencode",
			label: "OpenCode",
			binary: "opencode",
			installed: true,
			tested: null,
			install: "brew install opencode",
			defaultModel: null,
			modelVia: "config" as const,
			loginHint: "",
			models: { source: "catalogue" as const, asOf: "", entries: [] },
		},
		{
			id: "codex",
			label: "Codex",
			binary: "codex",
			installed: true,
			tested: null,
			install: "npm i -g @openai/codex",
			defaultModel: null,
			modelVia: "unsupported" as const,
			loginHint: "",
			models: { source: "catalogue" as const, asOf: "", entries: [] },
		},
	],
	selection: {
		harness: "codex",
		runnable: true,
		pinned: true,
		pinnedBy: "settings",
		blockedReason: null,
	},
};

let mockSettingsData = {
	harness: "codex",
	models: {},
};

vi.mock("@/components/ui/popover", () => ({
	Popover: ({ children }: { children: React.ReactNode }) => children,
	PopoverTrigger: ({ children }: { children: React.ReactNode }) => children,
	PopoverContent: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/lib/api/hooks", () => ({
	useHarnesses: () => ({
		data: mockHarnessesData,
		isLoading: false,
		isError: false,
	}),
	useHarnessSettings: () => ({
		data: mockSettingsData,
		isLoading: false,
	}),
	useUpdateHarnessSettings: () => ({ mutate: vi.fn() }),
}));

describe("AgentModelPicker Auto row (f9)", () => {
	beforeEach(() => {
		mockSettingsData = {
			harness: "codex",
			models: {},
		};
		mockHarnessesData = {
			harnesses: [
				{
					id: "opencode",
					label: "OpenCode",
					binary: "opencode",
					installed: true,
					tested: null,
					install: "brew install opencode",
					defaultModel: null,
					modelVia: "config",
					loginHint: "",
					models: { source: "catalogue", asOf: "", entries: [] },
				},
				{
					id: "codex",
					label: "Codex",
					binary: "codex",
					installed: true,
					tested: null,
					install: "npm i -g @openai/codex",
					defaultModel: null,
					modelVia: "unsupported",
					loginHint: "",
					models: { source: "catalogue", asOf: "", entries: [] },
				},
			],
			selection: {
				harness: "codex",
				runnable: true,
				pinned: true,
				pinnedBy: "settings",
				blockedReason: null,
			},
		};
	});

	it("shows the agent Auto would pick (first on PATH) in the Auto row, not the chosen one", () => {
		// Codex chosen, OpenCode first on PATH -> Auto row reads "now OpenCode"
		const html = renderToStaticMarkup(
			React.createElement(AgentModelPicker, { defaultOpen: true }),
		);

		expect(html).toContain("now OpenCode");
		expect(html).not.toContain("now Codex");
	});
});
