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
		{
			agent: "opencode",
			provider: "openrouter",
			model: "z-ai/glm-5",
			perMillion: { input: 1, output: 3.2 },
		},
	],
};
const load = vi.hoisted(() => vi.fn<() => Promise<ModelPrices>>());
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
					queryFn: load,
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
	load.mockReset().mockImplementation(async () => stored);
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

async function render(shows = "price-line") {
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{
					client: new QueryClient({
						defaultOptions: { queries: { retry: false } },
					}),
				},
				createElement(PriceOverrides, { agents: ["opencode"] }),
			),
		);
	});
	await vi.waitFor(() => {
		if (!q(shows)) throw new Error(`${shows} has not drawn`);
	});
}

const all = (id: string) =>
	Array.from(
		container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
	);
const removeButtons = () =>
	all("price-row").map((r) => r.querySelector("button") as HTMLButtonElement);
const saveButton = () => q("price-save") as HTMLButtonElement;

async function fillPrice() {
	await act(async () => q("price-add")?.click());
	await act(async () => {
		type("price-model", "m");
		type("price-input", "1");
		type("price-output", "2");
	});
}

describe("usage.prices (#1180)", () => {
	it("draws its group at its anchor, with each stored price on a row", async () => {
		await render();
		expect(usagePrices.anchor).toBe("usage-prices");
		expect(q("usage-prices")?.textContent).toContain("Prices");
		expect(all("price-line").map((l) => l.textContent)).toEqual([
			"Claude Code, Any route. $5 in, $25 out per million",
			"OpenCode, openrouter. $1 in, $3.2 out per million",
		]);
	});

	it("saves nothing while the stored list has not been read, and says it could not", async () => {
		load.mockImplementation(async () => {
			throw new Error("offline");
		});
		await render("state-problem");
		expect(q("state-problem")?.textContent).toContain(
			"Your prices did not load.",
		);
		expect(q("state-empty")).toBeNull();
		await fillPrice();
		expect(saveButton().disabled).toBe(true);
		await act(async () => {
			q("price-form")?.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		});
		expect(setPrices).not.toHaveBeenCalled();
	});

	it("saves the first price once an empty list has been read", async () => {
		load.mockImplementation(async () => ({ prices: [] }));
		await render("state-empty");
		await fillPrice();
		await act(async () => saveButton().click());
		expect(setPrices.mock.calls.map((c) => c[0])).toEqual([
			{
				prices: [
					{
						agent: "opencode",
						provider: null,
						model: "m",
						perMillion: { input: 1, output: 2 },
					},
				],
			},
		]);
	});

	it("takes no second removal while one is saving", async () => {
		setPrices.mockImplementationOnce(() => new Promise<ModelPrices>(() => {}));
		await render();
		await act(async () => removeButtons()[0]?.click());
		await vi.waitFor(() => {
			if (!removeButtons()[1]?.disabled) throw new Error("not saving yet");
		});
		await act(async () => removeButtons()[1]?.click());
		expect(setPrices.mock.calls.map((c) => c[0])).toEqual([
			{ prices: [stored.prices[1]] },
		]);
	});

	it.each([
		["price-cache-read", "-1"],
		["price-cache-read", "abc"],
		["price-cache-write", "-1"],
		["price-cache-write", "abc"],
	])("keeps Save off while %s holds %s", async (field, typed) => {
		await render();
		await fillPrice();
		await act(async () => type(field, typed));
		expect(saveButton().disabled).toBe(true);
	});

	it.each([
		["price-cache-read", "cacheRead"],
		["price-cache-write", "cacheWrite"],
	])("keeps a zero typed in %s", async (field, key) => {
		await render();
		await fillPrice();
		await act(async () => type(field, "0"));
		await act(async () => saveButton().click());
		expect(setPrices.mock.calls[0]?.[0].prices.at(-1)?.perMillion).toEqual({
			input: 1,
			output: 2,
			[key]: 0,
		});
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
