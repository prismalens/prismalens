// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { UsageBucket, UsageSummary } from "@prismalens/contracts";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { renderWithApp } from "@/test/render";
import { UsageReport } from "./UsageReport";

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		usage: {
			prices: {
				queryOptions: () => ({
					queryKey: ["usage", "prices"],
					queryFn: async () => ({ prices: [] }),
				}),
			},
			setPrices: { mutationOptions: () => ({}) },
		},
	},
}));

const bucket = (estimate: number | null): UsageBucket => ({
	turns: 1,
	tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
	cost: {
		amount: null,
		currency: "USD",
		unpricedTurns: 1,
		estimate,
		estimatedTurns: estimate === null ? 0 : 1,
	},
});

const summary = (
	models: { model: string; estimate: number | null }[],
): UsageSummary => ({
	range: "7d",
	since: "2026-11-19T00:00:00.000Z",
	until: "2026-11-26T00:00:00.000Z",
	step: "day",
	totals: bucket(null),
	threads: 1,
	days: [],
	models: models.map((m) => ({
		...bucket(m.estimate),
		model: m.model,
		agent: "opencode",
		days: [],
	})),
	projects: [],
	agents: ["opencode"],
	silentAgents: [],
});

const view = (s: UsageSummary) => (
	<TooltipProvider>
		<UsageReport summary={s} measure="tokens" />
	</TooltipProvider>
);
const card = () =>
	document.body.querySelector('[data-testid="usage-model-card"]');
const open = async () => {
	const row = document.body.querySelector<HTMLButtonElement>(
		'[data-testid="usage-model-row"]',
	);
	await act(async () => row?.click());
};

describe("UsageReport's model card (#1180)", () => {
	it("shows the model's row as the newest summary has it, and closes once the row is gone", async () => {
		const app = await renderWithApp(
			view(summary([{ model: "m", estimate: null }])),
		);
		await open();
		expect(card()?.textContent).not.toContain("API estimate");
		await app.rerender(view(summary([{ model: "m", estimate: 12.34 }])));
		expect(card()?.textContent).toContain("API estimate$12.34");
		await app.rerender(view(summary([{ model: "other", estimate: 1 }])));
		expect(card()).toBeNull();
		await app.unmount();
	});
});
