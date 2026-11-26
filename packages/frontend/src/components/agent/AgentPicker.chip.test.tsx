// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ModelChip } from "./AgentPicker";

const GOOGLE_MODEL = "google/gemini-4-neon";

const opencode: HarnessStatus = {
	id: "opencode",
	label: "OpenCode",
	binary: "opencode",
	installed: true,
	runnable: true,
	tested: null,
	install: "",
	defaultModel: null,
	localDefault: { permission: null },
	modelVia: "acp",
	loginHint: "",
	envModel: null,
	windowsOnlyPath: null,
	cliBinary: "",
	configDir: null,
	providerKeys: [],
	envVars: [],
	models: {
		source: "harness",
		asOf: "",
		entries: [{ id: GOOGLE_MODEL, name: "Google/Gemini 4 Neon", status: null }],
	},
	checked: null,
};

let mockSettings: Record<string, unknown> = {
	harness: "opencode",
	models: {},
};

vi.mock("@/lib/api/hooks", () => ({
	useHarnesses: () => ({
		data: {
			harnesses: [opencode],
			selection: { harness: "opencode" },
		},
		isLoading: false,
		isError: false,
	}),
	useHarnessSettings: () => ({
		data: mockSettings,
		isLoading: false,
	}),
	useUpdateHarnessSettings: () => ({ mutate: vi.fn(), isPending: false }),
	useCheckHarness: () => ({ mutate: vi.fn(), isPending: false }),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ModelChip", () => {
	it("shows the Google logo, not the OpenCode logo, for OpenCode on a google model", () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		act(() =>
			createRoot(host).render(
				<ModelChip harness={opencode} model={GOOGLE_MODEL} onPick={vi.fn()} />,
			),
		);
		const logos = host.querySelectorAll("[data-testid=agent-logo]");
		expect(logos).toHaveLength(1);
		expect(logos[0]?.getAttribute("data-brand")).toBe("google");
		expect(host.querySelector("[data-testid=maker-lettermark]")).toBeNull();
	});

	it("names the agent the model runs on after the model, so a maker's mark is never alone", () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		act(() =>
			createRoot(host).render(
				<ModelChip harness={opencode} model={GOOGLE_MODEL} onPick={vi.fn()} />,
			),
		);
		expect(
			host
				.querySelector("[data-testid=agent-picker]")
				?.getAttribute("aria-label"),
		).toBe("Model: Gemini 4 Neon · via OpenCode");
	});

	it("names a custom model by the person's name, on the chip and on its rows", async () => {
		mockSettings = {
			harness: "opencode",
			models: { opencode: "gw-a" },
			customModels: { opencode: [{ id: "gw-a", name: "Gateway A" }] },
		};
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host);
		try {
			await act(async () =>
				root.render(
					<TooltipProvider>
						<ModelChip harness={opencode} model="gw-a" onPick={vi.fn()} />
					</TooltipProvider>,
				),
			);
			const chip = host.querySelector(
				"[data-testid=agent-picker]",
			) as HTMLButtonElement;
			expect(chip.getAttribute("aria-label")).toBe(
				"Model: Gateway A \u00b7 via OpenCode",
			);
			await act(async () => chip.click());
			const rows = () =>
				Array.from(
					document.body.querySelectorAll("[data-testid=model-option]"),
				).map((r) => r.textContent);
			expect(rows()).toEqual(["Gateway A", "Gemini 4 Neon"]);
			await act(async () =>
				(
					document.body.querySelector(
						"[data-testid=rail-starred]",
					) as HTMLButtonElement
				).click(),
			);
			expect(rows()).toEqual(["Gateway A"]);
		} finally {
			await act(async () => root.unmount());
			mockSettings = { harness: "opencode", models: {} };
			document.body.innerHTML = "";
		}
	});

	it("shows the OpenCode logo when the model names no maker", () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		act(() =>
			createRoot(host).render(
				<ModelChip
					harness={opencode}
					model="fixture-current"
					onPick={vi.fn()}
				/>,
			),
		);
		const logos = host.querySelectorAll("[data-testid=agent-logo]");
		expect(logos).toHaveLength(1);
		expect(logos[0]?.getAttribute("data-brand")).toBe("opencode");
		expect(host.querySelector("[data-testid=maker-lettermark]")).toBeNull();
	});
});
