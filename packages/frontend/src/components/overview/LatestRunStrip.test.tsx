// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LatestRunStrip } from "./LatestRunStrip";
import type { Overview } from "./use-overview";

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
