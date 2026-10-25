// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LatestRunStrip } from "./LatestRunStrip";
import type { Overview } from "./use-overview";
import { WhyCard } from "./WhyCard";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/run/RunsMenu", () => ({ RunsMenu: () => null }));
vi.mock("@/components/incidents/RunTree", () => ({ RunDot: () => null }));
vi.mock("@/components/incidents/run-facts", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/components/incidents/run-facts")
	>()),
	runElapsed: () => 0,
	runTimed: () => false,
	useRunAgentModel: () => ({ agent: "Claude Code", model: "haiku" }),
}));

const latest = {
	id: "run-2",
	kind: "investigation",
	status: "running",
	createdAt: "2026-10-13T00:00:00Z",
};

const overview = (latestText: string) =>
	({
		record: { incident: { id: "inc-4" }, runs: [latest] },
		latest,
		latestRun: {
			investigation: null,
			state: "working",
			awaiting: false,
			asks: [],
			latestText,
			stopRequested: false,
			stop: () => undefined,
		},
	}) as unknown as Overview;

describe("LatestRunStrip (#673 w9-2)", () => {
	it("Given the agent's message has inline Markdown, Then the one-line preview reads plain", () => {
		const html = renderToStaticMarkup(
			createElement(LatestRunStrip, {
				o: overview("Checking `booklogr-api` with **docker inspect**"),
			}),
		);
		expect(html).toContain("Checking booklogr-api with docker inspect");
		expect(html).not.toContain("`");
	});
});

describe("WhyCard preRun coverage (#848 case 14)", () => {
	it("renders why-coverage when preRun is non-null, and omits it when null", () => {
		const withPreRun = {
			...overview("test"),
			report: null,
			latest,
			latestRun: {
				...overview("test").latestRun,
				investigation: {
					preRun: {
						state: "ready",
						fetchedAt: "2026-10-25T00:00:00Z",
						window: {
							start: "2026-10-25T00:00:00Z",
							end: "2026-10-25T01:00:00Z",
						},
						notConfigured: [],
						runbooks: [],
						files: [],
						sources: [],
						checkoutsSkipped: [],
					},
				},
			},
		} as unknown as Overview;

		const htmlWith = renderToStaticMarkup(
			createElement(WhyCard, {
				o: withPreRun,
				onInvestigate: vi.fn(),
			}),
		);
		expect(htmlWith).toContain('data-testid="why-coverage"');

		const withoutPreRun = {
			...overview("test"),
			report: null,
			latest,
			latestRun: {
				...overview("test").latestRun,
				investigation: null,
			},
		} as unknown as Overview;

		const htmlWithout = renderToStaticMarkup(
			createElement(WhyCard, {
				o: withoutPreRun,
				onInvestigate: vi.fn(),
			}),
		);
		expect(htmlWithout).not.toContain('data-testid="why-coverage"');
	});
});
