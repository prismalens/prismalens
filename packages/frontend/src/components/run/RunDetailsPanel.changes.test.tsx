// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RunDetailsPanel } from "./RunDetailsPanel";

vi.mock("@/components/run/EvidenceFileView", () => ({
	EvidenceFileView: () => null,
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("./ChangesTab", async () => {
	const { useState } = await import("react");
	return {
		ChangesTab: () => {
			const [picked, setPicked] = useState(false);
			return (
				<button
					type="button"
					data-testid="changes-state"
					onClick={() => setPicked(true)}
				>
					{picked ? "picked" : "fresh"}
				</button>
			);
		},
	};
});

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const panel = (runId: string) => (
	<TooltipProvider>
		<RunDetailsPanel
			title="Run Details"
			tab="changes"
			onTab={vi.fn()}
			onClose={vi.fn()}
			incidentId="inc-1"
			summary={[]}
			evidence={[]}
			context={[]}
			flaggedCount={0}
			steps={[]}
			onJump={vi.fn()}
			files={{
				workspace: null,
				touched: [],
				runId,
				viewing: null,
				onOpen: vi.fn(),
				onClose: vi.fn(),
				backLabel: "Back",
				reads: [],
				codeHost: null,
				stepFile: () => null,
				links: [],
				onOpenHypotheses: vi.fn(),
			}}
		/>
	</TooltipProvider>
);

describe("Changes tab across runs (#975)", () => {
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

	const state = () =>
		container.querySelector('[data-testid="changes-state"]')?.textContent;

	it("switching runId resets the selection", async () => {
		await act(async () => root.render(panel("run-1")));
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[data-testid="changes-state"]')
				?.click();
		});
		expect(state()).toBe("picked");

		await act(async () => root.render(panel("run-1")));
		expect(state()).toBe("picked");

		await act(async () => root.render(panel("run-2")));
		expect(state()).toBe("fresh");
	});

	it("draws each tab as an icon, named for assistive tech (#1020)", async () => {
		await act(async () => root.render(panel("run-1")));
		const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
		expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual([
			"Summary",
			"Files, 0",
			"Changes",
			"Steps, 0",
			"Context",
			"Browser",
		]);
		for (const t of tabs) expect(t.querySelector("svg")).not.toBeNull();
		// The open tab's name shows beside its icon only where nothing can hover.
		const labels = tabs.map((t) =>
			t.querySelector('[data-testid^="run-details-label-"]'),
		);
		expect(
			labels.map((l) =>
				l?.className.includes(
					"[@media(hover:none)]:group-data-[state=active]:inline",
				),
			),
		).toEqual(Array(6).fill(true));
		for (const l of labels) l?.remove();
		expect(tabs.map((t) => t.textContent)).toEqual(["", "0", "", "0", "", ""]);
	});
});
