// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ModelPrices } from "@prismalens/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PriceOverrides } from "@/components/usage/PriceOverrides";
import { usagePrices } from "./usage.settings";

const stored: ModelPrices = {
	prices: [
		{
			agent: "claude-code",
			provider: null,
			model: "claude-opus-5-5",
			perMillion: { input: 5, output: 25 },
		},
	],
};
const setPrices = vi.hoisted(() =>
	vi.fn(async (input: ModelPrices) => input),
);

vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		usage: {
			prices: {
				queryKey: () => ["usage", "prices"],
				queryOptions: () => ({
					queryKey: ["usage", "prices"],
					queryFn: async () => stored,
				}),
			},
			setPrices: { mutationOptions: () => ({ mutationFn: setPrices }) },
			summary: { key: () => ["usage", "summary"] },
		},
	},
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	setPrices.mockClear();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

const q = (id: string) =>
	container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function type(id: string, value: string) {
	const el = q(id) as HTMLInputElement;
	const set = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	set?.call(el, value);
	el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function render() {
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client: new QueryClient() },
				createElement(PriceOverrides, { agents: ["opencode"] }),
			),
		);
	});
	await vi.waitFor(() => {
		if (!q("price-line")) throw new Error("the stored price has not loaded");
	});
}

describe("usage.prices (#1180)", () => {
	it("draws its group at its anchor, with each stored price on a row", async () => {
		await render();
		expect(usagePrices.anchor).toBe("usage-prices");
		expect(q("usage-prices")?.textContent).toContain("Prices");
		expect(q("price-line")?.textContent).toBe(
			"Claude Code, Any route. $5 in, $25 out per million",
		);
	});

	it("adds a price beside the stored ones, with the route and cache price typed", async () => {
		await render();
		await act(async () => q("price-add")?.click());
		await act(async () => {
			type("price-model", "google/gemini-2.5-flash");
			type("price-route", "google");
			type("price-input", "0.3");
			type("price-output", "2.5");
			type("price-cache-read", "0.075");
		});
		await act(async () => q("price-save")?.click());
		expect(setPrices.mock.calls[0]?.[0]).toEqual({
			prices: [
				...stored.prices,
				{
					agent: "opencode",
					provider: "google",
					model: "google/gemini-2.5-flash",
					perMillion: { input: 0.3, output: 2.5, cacheRead: 0.075 },
				},
			],
		});
	});
});
