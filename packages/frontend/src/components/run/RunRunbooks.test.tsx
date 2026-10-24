// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
// @vitest-environment happy-dom

import type { PreRunSummary } from "@prismalens/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunDetailsPanel } from "./RunDetailsPanel";
import { RunRunbooks } from "./RunRunbooks";

vi.mock("@/components/run/EvidenceFileView", () => ({
	EvidenceFileView: () => null,
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => children,
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("RunRunbooks (#848)", () => {
	let container: HTMLDivElement | null = null;
	let root: ReturnType<typeof createRoot> | null = null;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		if (container) {
			act(() => root?.unmount());
			container.remove();
			container = null;
			root = null;
		}
	});

	it("renders runbooks-no-snapshot when preRun is null", async () => {
		await act(async () => {
			root?.render(<RunRunbooks preRun={null} />);
		});
		const el = container?.querySelector('[data-testid="runbooks-no-snapshot"]');
		expect(el).not.toBeNull();
		expect(el?.textContent).toContain(
			"This run has no snapshot, so no runbooks were listed for it.",
		);
	});

	it("renders runbooks-skipped when runbooks were skipped with a reason", async () => {
		const preRun: PreRunSummary = {
			runbooks: [],
			runbooksSkipped: "the scan timed out",
			coverage: [],
			checkoutsSkipped: [],
		};
		await act(async () => {
			root?.render(<RunRunbooks preRun={preRun} />);
		});
		const el = container?.querySelector('[data-testid="runbooks-skipped"]');
		expect(el).not.toBeNull();
		expect(el?.textContent).toBe(
			"The runbook scan was skipped: the scan timed out",
		);
	});

	it("renders runbooks-load-error when loadError is true", async () => {
		await act(async () => {
			root?.render(<RunRunbooks preRun={null} loadError={true} />);
		});
		const el = container?.querySelector('[data-testid="runbooks-load-error"]');
		expect(el).not.toBeNull();
		expect(el?.textContent).toBe("This run's runbooks did not load.");
		expect(
			container?.querySelector('[data-testid="runbooks-skipped"]'),
		).toBeNull();
		expect(
			container?.querySelector('[data-testid="runbooks-no-snapshot"]'),
		).toBeNull();
	});

	it("renders runbooks-none when no runbooks found", async () => {
		const preRun: PreRunSummary = {
			runbooks: [],
			coverage: [],
			checkoutsSkipped: [],
		};
		await act(async () => {
			root?.render(<RunRunbooks preRun={preRun} />);
		});
		const el = container?.querySelector('[data-testid="runbooks-none"]');
		expect(el).not.toBeNull();
		expect(el?.textContent).toBe(
			"No runbook was found in the repositories this run read.",
		);
	});

	it("renders cards with File chip for local runbooks and Link chip with Open anchor for linked ones", async () => {
		const preRun: PreRunSummary = {
			runbooks: [
				{
					title: "Deploy guide",
					path: "docs/deploy.md",
					service: "auth-service",
				},
				{
					title: "Incident runbook",
					path: "https://wiki.internal/runbook",
					link: "https://wiki.internal/runbook",
					service: "api-service",
				},
			],
			coverage: [],
			checkoutsSkipped: [],
		};

		await act(async () => {
			root?.render(<RunRunbooks preRun={preRun} />);
		});

		const cards = container?.querySelectorAll('[data-testid="runbook-card"]');
		expect(cards?.length).toBe(2);

		const firstCard = cards?.[0];
		expect(firstCard?.textContent).toContain("Deploy guide");
		expect(firstCard?.textContent).toContain("docs/deploy.md");
		expect(firstCard?.textContent).toContain("File");
		expect(firstCard?.textContent).toContain("auth-service");
		expect(firstCard?.querySelector("a")).toBeNull();

		const secondCard = cards?.[1];
		expect(secondCard?.textContent).toContain("Incident runbook");
		expect(secondCard?.textContent).toContain("https://wiki.internal/runbook");
		expect(secondCard?.textContent).toContain("Link");
		expect(secondCard?.textContent).toContain("api-service");
		const anchor = secondCard?.querySelector("a");
		expect(anchor).not.toBeNull();
		expect(anchor?.getAttribute("href")).toBe("https://wiki.internal/runbook");
		expect(anchor?.getAttribute("target")).toBe("_blank");
	});

	it("renders contextTop inside the context tab of RunDetailsPanel", async () => {
		await act(async () => {
			root?.render(
				<RunDetailsPanel
					title="Run Details"
					tab="context"
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
						viewing: null,
						onOpen: vi.fn(),
						onClose: vi.fn(),
						onOpenHypotheses: vi.fn(),
					}}
					contextTop={
						<div data-testid="test-context-top">Top Context Runbooks</div>
					}
				/>,
			);
		});
		const contextPanel = container?.querySelector(
			'[data-testid="run-details-context"]',
		);
		expect(contextPanel).not.toBeNull();
		expect(
			contextPanel?.querySelector('[data-testid="test-context-top"]'),
		).not.toBeNull();
	});
});
