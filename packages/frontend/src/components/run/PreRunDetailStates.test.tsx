// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PreRunDetail, PreRunSource } from "@prismalens/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Overview } from "@/components/overview/use-overview";
import { WhyCard } from "@/components/overview/WhyCard";
import { PreRunCoverage, preRunRead, snapshotLine } from "./PreRunCoverage";
import { RunRunbooks } from "./RunRunbooks";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, ...props }: { children?: React.ReactNode }) =>
		createElement("a", props, children),
}));

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
	vi.restoreAllMocks();
});

const sampleSources: PreRunSource[] = [
	{
		kind: "prometheus",
		label: "Prometheus",
		from: "set",
		status: "found",
		detail: "10 metrics",
	},
	{
		kind: "alertmanager",
		label: "Alertmanager",
		from: "env",
		status: "empty",
		detail: "No alerts",
	},
	{
		kind: "loki",
		label: "Loki",
		from: "set",
		status: "skipped",
		detail: "Auth refused",
	},
];

describe("PreRunCoverage detail states (#848 case 21)", () => {
	it("renders coverage-unavailable without reason text or metrics when state is unavailable", async () => {
		const preRun: PreRunDetail = {
			state: "unavailable",
			reason: "SQLITE_CORRUPT: disk failure",
			checkoutsSkipped: [],
		};

		await act(async () =>
			root.render(createElement(PreRunCoverage, { preRun })),
		);

		const banner = container.querySelector(
			'[data-testid="coverage-unavailable"]',
		);
		expect(banner).not.toBeNull();
		expect(banner?.textContent).toContain("No snapshot for this run");
		expect(banner?.textContent).toContain("No snapshot");
		expect(banner?.textContent).toContain(
			"This follow-up has no stored snapshot, so it ran without telemetry.",
		);

		// reason text never renders
		expect(container.textContent).not.toContain("SQLITE_CORRUPT: disk failure");
		expect(
			container.querySelector('[data-testid="pre-run-coverage"]'),
		).toBeNull();
		expect(container.querySelector('[data-testid="coverage-read"]')).toBeNull();
		expect(
			container.querySelector('[data-testid="coverage-sources"]'),
		).toBeNull();
	});

	it("renders coverage-not-saved banner and rows without saveError text when state is not-saved", async () => {
		const preRun: PreRunDetail = {
			state: "not-saved",
			saveError: "SQLITE_BUSY: locked",
			fetchedAt: "2026-10-25T00:00:00Z",
			window: { start: "2026-10-25T00:00:00Z", end: "2026-10-25T01:00:00Z" },
			notConfigured: [],
			runbooks: [],
			files: [],
			sources: sampleSources,
			checkoutsSkipped: [],
		};

		await act(async () =>
			root.render(createElement(PreRunCoverage, { preRun })),
		);

		const notSaved = container.querySelector(
			'[data-testid="coverage-not-saved"]',
		);
		expect(notSaved).not.toBeNull();
		expect(notSaved?.textContent).toContain(
			"Snapshot not saved. This run read it; a follow-up will not have it.",
		);
		expect(container.textContent).not.toContain("SQLITE_BUSY: locked");

		// Counts and rows are rendered
		expect(
			container.querySelector('[data-testid="coverage-read"]')?.textContent,
		).toBe("2");
		expect(
			container.querySelectorAll('[data-testid="coverage-result"]').length,
		).toBe(3);
	});

	it("renders neither banner when state is ready", async () => {
		const preRun: PreRunDetail = {
			state: "ready",
			fetchedAt: "2026-10-25T00:00:00Z",
			window: { start: "2026-10-25T00:00:00Z", end: "2026-10-25T01:00:00Z" },
			notConfigured: [],
			runbooks: [],
			files: [],
			sources: sampleSources,
			checkoutsSkipped: [],
		};

		await act(async () =>
			root.render(createElement(PreRunCoverage, { preRun })),
		);

		expect(
			container.querySelector('[data-testid="coverage-unavailable"]'),
		).toBeNull();
		expect(
			container.querySelector('[data-testid="coverage-not-saved"]'),
		).toBeNull();
		expect(
			container.querySelector('[data-testid="pre-run-coverage"]'),
		).not.toBeNull();
	});
});

describe("PreRunCoverage telemetry skipped (#848 case 22)", () => {
	it("renders coverage-telemetry-skipped in separate paragraph and coverage-notes lists only notConfigured", async () => {
		const preRun: PreRunDetail = {
			state: "ready",
			fetchedAt: "2026-10-25T00:00:00Z",
			window: { start: "2026-10-25T00:00:00Z", end: "2026-10-25T01:00:00Z" },
			telemetrySkipped: "it did not finish in 30 s, or failed",
			notConfigured: [{ kind: "prometheus", services: ["api-gateway"] }],
			runbooks: [],
			files: [],
			sources: [],
			checkoutsSkipped: [],
		};

		await act(async () =>
			root.render(createElement(PreRunCoverage, { preRun })),
		);

		const skippedEl = container.querySelector(
			'[data-testid="coverage-telemetry-skipped"]',
		);
		expect(skippedEl).not.toBeNull();
		expect(skippedEl?.textContent?.trim()).toBe(
			"The telemetry read was skipped: it did not finish in 30 s, or failed",
		);

		const notes = container.querySelector('[data-testid="coverage-notes"]');
		expect(notes).not.toBeNull();
		expect(notes?.textContent).not.toContain("The telemetry read was skipped");
		expect(notes?.textContent).toContain(
			"No Prometheus is set up for api-gateway.",
		);
	});
});

describe("snapshotLine and preRunRead (#848 case 23)", () => {
	const readyPreRun: PreRunDetail = {
		state: "ready",
		fetchedAt: "2026-10-25T00:00:00Z",
		window: { start: "2026-10-25T00:00:00Z", end: "2026-10-25T01:00:00Z" },
		notConfigured: [],
		runbooks: [],
		files: [],
		sources: sampleSources,
		checkoutsSkipped: [],
	};

	const notSavedPreRun: PreRunDetail = {
		state: "not-saved",
		saveError: "disk full",
		fetchedAt: "2026-10-25T00:00:00Z",
		window: { start: "2026-10-25T00:00:00Z", end: "2026-10-25T01:00:00Z" },
		notConfigured: [],
		runbooks: [],
		files: [],
		sources: sampleSources,
		checkoutsSkipped: [],
	};

	const unavailablePreRun: PreRunDetail = {
		state: "unavailable",
		reason: "no snapshot stored",
		checkoutsSkipped: [],
	};

	it("computes snapshotLine for null, unavailable, ready, and not-saved", () => {
		expect(snapshotLine(null)).toBe("No snapshot");
		expect(snapshotLine(undefined)).toBe("No snapshot");
		expect(snapshotLine(unavailablePreRun)).toBe("No snapshot");
		expect(snapshotLine(readyPreRun)).toBe("2 read, 1 skipped");
		expect(snapshotLine(notSavedPreRun)).toBe("2 read, 1 skipped, not saved");
	});

	it("computes preRunRead returning null for null, undefined, unavailable, and returning object otherwise", () => {
		expect(preRunRead(null)).toBeNull();
		expect(preRunRead(undefined)).toBeNull();
		expect(preRunRead(unavailablePreRun)).toBeNull();
		expect(preRunRead(readyPreRun)).toBe(readyPreRun);
		expect(preRunRead(notSavedPreRun)).toBe(notSavedPreRun);
	});
});

describe("RunRunbooks on a detail (#848 case 24)", () => {
	it("renders runbooks-no-snapshot for unavailable detail", async () => {
		const preRun: PreRunDetail = {
			state: "unavailable",
			reason: "missing",
			checkoutsSkipped: [],
		};

		await act(async () => {
			root.render(createElement(RunRunbooks, { preRun }));
		});
		expect(
			container.querySelector('[data-testid="runbooks-no-snapshot"]'),
		).not.toBeNull();
	});

	it("lists runbooks on a not-saved detail", async () => {
		const preRun: PreRunDetail = {
			state: "not-saved",
			saveError: "error",
			fetchedAt: "2026-10-25T00:00:00Z",
			window: { start: "2026-10-25T00:00:00Z", end: "2026-10-25T01:00:00Z" },
			notConfigured: [],
			files: [],
			sources: [],
			checkoutsSkipped: [],
			runbooks: [
				{
					title: "Deploy guide",
					path: "docs/deploy.md",
					service: "auth-service",
					origin: "repo",
				},
			],
		};

		await act(async () => {
			root.render(createElement(RunRunbooks, { preRun }));
		});
		expect(
			container.querySelectorAll('[data-testid="runbook-card"]').length,
		).toBe(1);
	});

	it("runbooksSkipped wins over an empty list on a detail", async () => {
		const preRun: PreRunDetail = {
			state: "ready",
			fetchedAt: "2026-10-25T00:00:00Z",
			window: { start: "2026-10-25T00:00:00Z", end: "2026-10-25T01:00:00Z" },
			notConfigured: [],
			files: [],
			sources: [],
			checkoutsSkipped: [],
			runbooks: [],
			runbooksSkipped: "the scan timed out",
		};

		await act(async () => {
			root.render(createElement(RunRunbooks, { preRun }));
		});
		expect(
			container.querySelector('[data-testid="runbooks-skipped"]'),
		).not.toBeNull();
	});
});

describe("WhyCard with each PreRunDetail state", () => {
	const latest = {
		id: "run-2",
		kind: "investigation",
		status: "running",
		createdAt: "2026-10-13T00:00:00Z",
	};

	const makeOverview = (preRun: PreRunDetail | null): Overview =>
		({
			record: { incident: { id: "inc-4" }, runs: [latest] },
			latest,
			latestRun: {
				investigation: preRun ? { preRun } : null,
				state: "working",
				awaiting: false,
				asks: [],
				latestText: "test",
				stopRequested: false,
				stop: () => undefined,
			},
			report: null,
		}) as unknown as Overview;

	it("renders why-coverage for ready, not-saved, and unavailable states", () => {
		const states: PreRunDetail[] = [
			{
				state: "ready",
				fetchedAt: "2026-10-25T00:00:00Z",
				window: { start: "2026-10-25T00:00:00Z", end: "2026-10-25T01:00:00Z" },
				notConfigured: [],
				runbooks: [],
				files: [],
				sources: [],
				checkoutsSkipped: [],
			},
			{
				state: "not-saved",
				saveError: "locked",
				fetchedAt: "2026-10-25T00:00:00Z",
				window: { start: "2026-10-25T00:00:00Z", end: "2026-10-25T01:00:00Z" },
				notConfigured: [],
				runbooks: [],
				files: [],
				sources: [],
				checkoutsSkipped: [],
			},
			{
				state: "unavailable",
				reason: "none stored",
				checkoutsSkipped: [],
			},
		];

		for (const preRun of states) {
			const html = renderToStaticMarkup(
				createElement(WhyCard, {
					o: makeOverview(preRun),
					onInvestigate: vi.fn(),
				}),
			);
			expect(html).toContain('data-testid="why-coverage"');
		}
	});
});
