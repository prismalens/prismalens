// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
});
