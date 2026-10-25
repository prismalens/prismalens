// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PreRunDetail, PreRunSource } from "@prismalens/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coverageCounts, coverageLine, PreRunCoverage } from "./PreRunCoverage";

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

describe("PreRunCoverage counts and line (case 13)", () => {
	it("computes coverageCounts and coverageLine for few, many, and zero read", () => {
		// Few: found, empty, skipped -> 2 read, 1 skipped
		const few: Pick<PreRunSource, "status">[] = [
			{ status: "found" },
			{ status: "empty" },
			{ status: "skipped" },
		];
		const cFew = coverageCounts(few);
		expect(cFew.read).toBe(2);
		expect(coverageLine(cFew)).toBe("2 read, 1 skipped");

		// Many: 4 found, 1 empty, 1 skipped, 2 not-read -> 5 read, 1 skipped, 2 not read
		const many: Pick<PreRunSource, "status">[] = [
			{ status: "found" },
			{ status: "found" },
			{ status: "found" },
			{ status: "found" },
			{ status: "empty" },
			{ status: "skipped" },
			{ status: "not-read" },
			{ status: "not-read" },
		];
		const cMany = coverageCounts(many);
		expect(cMany.read).toBe(5);
		expect(coverageLine(cMany)).toBe("5 read, 1 skipped, 2 not read");

		// All skipped -> 0 read
		const allSkipped: Pick<PreRunSource, "status">[] = [
			{ status: "skipped" },
			{ status: "skipped" },
		];
		const cSkipped = coverageCounts(allSkipped);
		expect(cSkipped.read).toBe(0);
		expect(coverageLine(cSkipped)).toBe("0 read, 2 skipped");
	});

	it("renders coverage-read count and coverage-line text", async () => {
		const preRun: PreRunDetail = {
			state: "ready",
			fetchedAt: "2026-10-25T00:00:00Z",
			window: { start: "2026-10-25T00:00:00Z", end: "2026-10-25T01:00:00Z" },
			notConfigured: [],
			runbooks: [],
			files: [],
			sources: [
				{
					kind: "prometheus",
					label: "Prometheus",
					from: "set",
					status: "found",
					detail: "12 metrics matched",
				},
				{
					kind: "alertmanager",
					label: "Alertmanager",
					from: "env",
					status: "empty",
					detail: "No firing alerts",
				},
				{
					kind: "loki",
					label: "Loki",
					from: "set",
					status: "skipped",
					detail: "Auth failed",
				},
			],
			checkoutsSkipped: [],
		};

		await act(async () =>
			root.render(createElement(PreRunCoverage, { preRun })),
		);
		expect(
			container.querySelector('[data-testid="coverage-read"]')?.textContent,
		).toBe("2");
		expect(
			container.querySelector('[data-testid="coverage-line"]')?.textContent,
		).toBe("2 read, 1 skipped");
	});
});

describe("PreRunCoverage snapshot states and rows (case 14)", () => {
	it("renders coverage-not-saved when state is not-saved", async () => {
		const preRun: PreRunDetail = {
			state: "not-saved",
			saveError: "disk full",
			fetchedAt: "2026-10-25T00:00:00Z",
			window: { start: "2026-10-25T00:00:00Z", end: "2026-10-25T01:00:00Z" },
			notConfigured: [],
			runbooks: [],
			files: [],
			sources: [],
			checkoutsSkipped: [],
		};

		await act(async () =>
			root.render(createElement(PreRunCoverage, { preRun })),
		);
		expect(
			container.querySelector('[data-testid="coverage-not-saved"]'),
		).not.toBeNull();
	});

	it("renders coverage-unavailable without throwing when state is unavailable", async () => {
		const preRun: PreRunDetail = {
			state: "unavailable",
			reason: "no snapshot",
			checkoutsSkipped: [],
		};

		await act(async () =>
			root.render(createElement(PreRunCoverage, { preRun })),
		);
		expect(
			container.querySelector('[data-testid="coverage-unavailable"]'),
		).not.toBeNull();
	});

	it("renders as saved when state is ready", async () => {
		const preRun: PreRunDetail = {
			state: "ready",
			fetchedAt: "2026-10-25T00:00:00Z",
			window: { start: "2026-10-25T00:00:00Z", end: "2026-10-25T01:00:00Z" },
			notConfigured: [],
			runbooks: [],
			files: [],
			sources: [],
			checkoutsSkipped: [],
		};

		await act(async () =>
			root.render(createElement(PreRunCoverage, { preRun })),
		);
		expect(
			container.querySelector('[data-testid="coverage-not-saved"]'),
		).toBeNull();
		expect(
			container.querySelector('[data-testid="coverage-unavailable"]'),
		).toBeNull();
	});

	it("renders telemetrySkipped and notConfigured notes", async () => {
		const preRun: PreRunDetail = {
			state: "ready",
			fetchedAt: "2026-10-25T00:00:00Z",
			window: { start: "2026-10-25T00:00:00Z", end: "2026-10-25T01:00:00Z" },
			telemetrySkipped: "timed out",
			notConfigured: [{ kind: "prometheus", services: ["api-gateway"] }],
			runbooks: [],
			files: [],
			sources: [],
			checkoutsSkipped: [],
		};

		await act(async () =>
			root.render(createElement(PreRunCoverage, { preRun })),
		);
		const skipped = container.querySelector(
			'[data-testid="coverage-telemetry-skipped"]',
		);
		expect(skipped?.textContent).toContain("timed out");
		const notes = container.querySelector('[data-testid="coverage-notes"]');
		expect(notes?.textContent).toContain(
			"No Prometheus is set up for api-gateway.",
		);
	});

	it("renders row results, truncated marker, fix link on skipped, and overridesEnv in details", async () => {
		const preRun: PreRunDetail = {
			state: "ready",
			fetchedAt: "2026-10-25T00:00:00Z",
			window: { start: "2026-10-25T00:00:00Z", end: "2026-10-25T01:00:00Z" },
			notConfigured: [],
			runbooks: [],
			files: [],
			sources: [
				{
					kind: "prometheus",
					label: "Prometheus",
					from: "set",
					status: "skipped",
					detail: "Token invalid",
					truncated: { dropped: 10, reason: "limit" },
					overridesEnv: "PROMETHEUS_KEY",
					credentialFrom: "stored",
				},
			],
			checkoutsSkipped: [],
		};

		await act(async () =>
			root.render(createElement(PreRunCoverage, { preRun })),
		);
		const result = container.querySelector('[data-testid="coverage-result"]');
		expect(result?.textContent).toBe("Skipped");

		expect(container.textContent).toContain("(truncated)");

		const fixLink = container.querySelector('[data-testid="coverage-fix"]');
		expect(fixLink).not.toBeNull();
		expect(fixLink?.getAttribute("to")).toBe("/settings");

		// Open details
		const expandBtn = container.querySelector('button[aria-label^="Details"]');
		await act(async () => (expandBtn as HTMLButtonElement)?.click());

		const over = container.querySelector('[data-testid="coverage-over"]');
		expect(over?.textContent).toContain("Over PROMETHEUS_KEY");

		// Verify no leaked selection sentences, file, window, or dropped count text
		expect(container.textContent).not.toContain("selectedBy");
		expect(container.textContent).not.toContain("window");
		expect(container.textContent).not.toContain("dropped");
	});
});
