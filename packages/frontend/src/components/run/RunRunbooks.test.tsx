// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
// @vitest-environment happy-dom

import type { PreRunDetail } from "@prismalens/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunDetailsPanel } from "./RunDetailsPanel";
import { RunRunbooks } from "./RunRunbooks";

vi.mock("@/components/run/EvidenceFileView", () => ({
	EvidenceFileView: () => null,
}));

const makePreRun = (
	p: Partial<PreRunDetail & { state: "ready" }> = {},
): PreRunDetail => ({
	state: "ready",
	fetchedAt: "2026-10-25T00:00:00Z",
	window: { start: "2026-10-25T00:00:00Z", end: "2026-10-25T01:00:00Z" },
	notConfigured: [],
	files: [],
	sources: [],
	checkoutsSkipped: [],
	runbooks: [],
	...p,
});

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
			root?.render(<RunRunbooks runId="run-1" preRun={null} />);
		});
		const el = container?.querySelector('[data-testid="runbooks-no-snapshot"]');
		expect(el).not.toBeNull();
		expect(el?.textContent).toContain(
			"This run has no snapshot, so no runbooks were listed for it.",
		);
	});

	it("renders runbooks-skipped when runbooks were skipped with a reason", async () => {
		const preRun = makePreRun({
			runbooksSkipped: "the scan timed out",
		});
		await act(async () => {
			root?.render(<RunRunbooks runId="run-1" preRun={preRun} />);
		});
		const el = container?.querySelector('[data-testid="runbooks-skipped"]');
		expect(el).not.toBeNull();
		expect(el?.textContent).toBe(
			"The runbook scan was skipped: the scan timed out",
		);
	});

	it("renders runbooks-load-error when loadError is true", async () => {
		await act(async () => {
			root?.render(
				<RunRunbooks runId="run-1" preRun={null} loadError={true} />,
			);
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
		const preRun = makePreRun();
		await act(async () => {
			root?.render(<RunRunbooks runId="run-1" preRun={preRun} />);
		});
		const el = container?.querySelector('[data-testid="runbooks-none"]');
		expect(el).not.toBeNull();
		expect(el?.textContent).toBe(
			"No runbook was found in the repositories this run read.",
		);
	});

	it("renders cards with File chip for local runbooks and Link chip with Open anchor for linked ones", async () => {
		const preRun = makePreRun({
			runbooks: [
				{
					title: "Deploy guide",
					path: "docs/deploy.md",
					service: "auth-service",
					origin: "repo",
				},
				{
					title: "Incident runbook",
					path: "https://wiki.internal/runbook",
					link: "https://wiki.internal/runbook",
					service: "api-service",
					origin: "repo",
				},
			],
		});

		await act(async () => {
			root?.render(<RunRunbooks runId="run-1" preRun={preRun} />);
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

	it("past eight runbooks, groups them by repository with search and service filters", async () => {
		const file = (repo: string, name: string, service: string) => ({
			title: name,
			path: `${repo}/runbooks/${name}.md`,
			service,
			origin: "repo" as const,
		});
		const runbooks = [
			file("checkout", "checkout-5xx", "checkout-api"),
			file("checkout", "db-failover", "checkout-api"),
			file("checkout", "rollback", "checkout-api"),
			file("payments", "card-declines", "payments"),
			file("payments", "refund-backlog", "payments"),
			{
				title: "payments-oncall",
				path: "https://wiki.example.com/payments-oncall",
				link: "https://wiki.example.com/payments-oncall",
				service: "payments",
				origin: "repo" as const,
			},
			file("checkout", "cert-expiry", "checkout-api"),
			file("billing", "invoice-stuck", "billing"),
		];
		const view = () =>
			container?.querySelector('[data-testid="runbooks-many"]');
		const groups = () =>
			Array.from(
				container?.querySelectorAll('[data-testid="runbooks-group"]') ?? [],
			).map(
				(g) =>
					`${g.getAttribute("aria-label")}:${g.querySelectorAll('[data-testid="runbook-card"]').length}`,
			);

		// Eight is still Few: one flat list, no controls.
		await act(async () => {
			root?.render(
				<RunRunbooks runId="run-1" preRun={makePreRun({ runbooks })} />,
			);
		});
		expect(view()).toBeNull();
		expect(
			container?.querySelectorAll('[data-testid="runbook-card"]').length,
		).toBe(8);

		await act(async () => {
			root?.render(
				<RunRunbooks
					runId="run-1"
					preRun={makePreRun({
						runbooks: [...runbooks, file("billing", "dunning", "billing")],
					})}
				/>,
			);
		});
		expect(view()).not.toBeNull();
		expect(groups()).toEqual([
			"checkout:4",
			"payments:2",
			"billing:2",
			"Links:1",
		]);
		// Inside its repository's group a path drops the repository's name.
		expect(
			container?.querySelector(
				'[aria-label="checkout"] [data-testid="runbook-card"]',
			)?.textContent,
		).toContain("runbooks/checkout-5xx.md");

		const press = (id: string) =>
			act(async () =>
				container
					?.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
					?.click(),
			);
		const type = (text: string) =>
			act(async () => {
				const search = container?.querySelector<HTMLInputElement>(
					'[data-testid="runbooks-search"]',
				);
				Object.getOwnPropertyDescriptor(
					HTMLInputElement.prototype,
					"value",
				)?.set?.call(search, text);
				search?.dispatchEvent(new Event("input", { bubbles: true }));
			});

		await press("runbooks-service-payments");
		expect(groups()).toEqual(["payments:2", "Links:1"]);
		await type("refund");
		expect(groups()).toEqual(["payments:1"]);
		await type("no such runbook");
		expect(groups()).toEqual([]);
		await press("runbooks-clear");
		expect(groups()).toEqual([
			"checkout:4",
			"payments:2",
			"billing:2",
			"Links:1",
		]);
	});

	const many = (services: string[]) =>
		services.flatMap((service) =>
			[1, 2, 3, 4, 5].map((n) => ({
				title: `${service}-${n}`,
				path: `${service}-repo/runbooks/${n}.md`,
				service,
				origin: "repo" as const,
			})),
		);
	const cards = () =>
		container?.querySelectorAll('[data-testid="runbook-card"]').length;
	const pressed = (id: string) =>
		container
			?.querySelector(`[data-testid="${id}"]`)
			?.getAttribute("aria-pressed");
	const press = (id: string) =>
		act(async () =>
			container
				?.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
				?.click(),
		);

	it("filters a service named all on its own, apart from All", async () => {
		await act(async () => {
			root?.render(
				<RunRunbooks
					runId="run-1"
					preRun={makePreRun({ runbooks: many(["all", "payments"]) })}
				/>,
			);
		});
		expect(cards()).toBe(10);
		await press("runbooks-service-all");
		expect(cards()).toBe(5);
		expect(pressed("runbooks-service-all")).toBe("true");
		expect(pressed("runbooks-all")).toBe("false");
		await press("runbooks-all");
		expect(cards()).toBe(10);
		expect(pressed("runbooks-service-all")).toBe("false");
	});

	it("starts the filters afresh when the run changes", async () => {
		await act(async () => {
			root?.render(
				<RunRunbooks
					runId="run-1"
					preRun={makePreRun({ runbooks: many(["checkout", "payments"]) })}
				/>,
			);
		});
		await press("runbooks-service-payments");
		await act(async () => {
			const search = container?.querySelector<HTMLInputElement>(
				'[data-testid="runbooks-search"]',
			);
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(search, "payments-1");
			search?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(cards()).toBe(1);

		await act(async () => {
			root?.render(
				<RunRunbooks
					runId="run-2"
					preRun={makePreRun({ runbooks: many(["billing", "search"]) })}
				/>,
			);
		});
		expect(cards()).toBe(10);
		expect(pressed("runbooks-all")).toBe("true");
		expect(
			container?.querySelector<HTMLInputElement>(
				'[data-testid="runbooks-search"]',
			)?.value,
		).toBe("");
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
						workspace: null,
						touched: [],
						links: [],
						runId: "run-1",
						viewing: null,
						onOpen: vi.fn(),
						onClose: vi.fn(),
						backLabel: "Back",
						reads: [],
						codeHost: null,
						stepFile: () => null,
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
