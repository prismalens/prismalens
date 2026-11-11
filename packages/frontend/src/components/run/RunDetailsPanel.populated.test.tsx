// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { type EvidenceFiles, RunDetailsPanel } from "./RunDetailsPanel";
import type { DetailSection } from "./run-details";
import type { RunStep } from "./run-steps";

vi.mock("@/components/run/EvidenceFileView", () => ({
	EvidenceFileView: () => null,
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("./ChangesTab", () => ({
	ChangesTab: () => <div data-testid="changes-tab" />,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const defaultFiles: EvidenceFiles = {
	workspace: null,
	touched: [],
	runId: "run-1",
	viewing: null,
	onOpen: vi.fn(),
	onClose: vi.fn(),
	backLabel: "Back",
	reads: [],
	codeHost: null,
	stepFile: () => null,
	links: [],
	onOpenHypotheses: vi.fn(),
};

const panel = (over: Partial<Parameters<typeof RunDetailsPanel>[0]> = {}) => (
	<TooltipProvider>
		<RunDetailsPanel
			title="Run Details"
			tab="summary"
			onTab={vi.fn()}
			onClose={vi.fn()}
			incidentId="inc-1"
			summary={[]}
			evidence={[]}
			context={[]}
			flaggedCount={0}
			steps={[]}
			onJump={vi.fn()}
			files={defaultFiles}
			{...over}
		/>
	</TooltipProvider>
);

describe("RunDetailsPanel populated (#1024)", () => {
	it("tab context shows a context section with a flagged item and contextTop runbook text inside the Incident tab body", async () => {
		const contextSections: DetailSection[] = [
			{
				title: "Database Context",
				rows: [
					{
						text: "Production Database",
						flag: "High latency detected",
					},
				],
			},
		];

		await act(async () => {
			root.render(
				panel({
					tab: "context",
					context: contextSections,
					flaggedCount: 1,
					contextTop: <p data-testid="runbook-top">Database restart runbook</p>,
				}),
			);
		});

		const body = container.querySelector(
			'[data-testid="panel-body"][data-tab="kind"]',
		);
		expect(body).not.toBeNull();
		const top = body?.querySelector('[data-testid="runbook-top"]');
		expect(top?.textContent).toBe("Database restart runbook");
		const flag = body?.querySelector('[data-testid="detail-flag"]');
		expect(flag?.textContent).toBe("High latency detected");
		const contextSection = body?.querySelector(
			'[data-testid="run-details-context"]',
		);
		expect(contextSection?.textContent).toContain("Production Database");
	});

	it("tab changes with changesTop shows kept-ws", async () => {
		await act(async () => {
			root.render(
				panel({
					tab: "changes",
					changesTop: <p data-testid="kept-workspaces">kept-ws</p>,
				}),
			);
		});

		const changesTopEl = container.querySelector(
			'[data-testid="kept-workspaces"]',
		);
		expect(changesTopEl?.textContent).toBe("kept-ws");
	});

	it("tab steps with a failed step shows its row with class text-danger and clicking it calls onJump", async () => {
		const onJump = vi.fn();
		const failedStep: RunStep = {
			n: 3,
			callId: "call-3",
			title: "Run test suite",
			command: "pnpm test",
			kind: "command",
			verb: "run",
			ok: false,
			unfinished: false,
			output: null,
			at: "2026-11-10T12:00:00.000Z",
			took: null,
			input: null,
		};

		await act(async () => {
			root.render(
				panel({
					tab: "steps",
					steps: [failedStep],
					onJump,
				}),
			);
		});

		const rowBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="steps-row"]',
		);
		expect(rowBtn?.getAttribute("data-step")).toBe("3");
		const dangerTitle = rowBtn?.querySelector(".text-danger");
		expect(dangerTitle?.textContent).toBe("Run test suite");

		await act(async () => {
			rowBtn?.click();
		});

		expect(onJump).toHaveBeenCalledWith(3);
	});
});
