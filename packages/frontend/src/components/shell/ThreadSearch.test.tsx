// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { feedInput, projectOptions } from "./ThreadFilters";

const h = vi.hoisted(() => ({
	phone: false,
	repoArgs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	Link: () => null,
}));
vi.mock("@/hooks/use-layout-prefs", () => ({
	useLayoutPrefs: () => ({ setBottomPanel: vi.fn() }),
}));
vi.mock("@/hooks/use-media-query", () => ({
	PHONE: "phone",
	useMediaQuery: () => h.phone,
}));
vi.mock("@/lib/api/hooks", () => ({
	useRepositories: (args: Record<string, unknown>) => {
		h.repoArgs.push(args);
		return { data: { data: [{ id: "r1", fullName: "shop" }], total: 1 } };
	},
}));
vi.mock("@/lib/api/hooks/use-threads-orpc", () => ({
	useThreadFeed: () => ({
		data: {
			pages: [
				{
					units: [
						{
							threads: [
								{ id: "t1", title: "Why the pool", kind: "chat" },
								{ id: "t2", title: "Checkout down", kind: "investigation" },
							],
						},
					],
				},
			],
		},
		hasNextPage: false,
	}),
}));
vi.mock("@/lib/thread-rows", () => ({
	rowContext: () => null,
	threadLink: () => ({ to: "/" }),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
// cmdk measures and scrolls; happy-dom lacks these.
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

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

describe("the search palette (#1020)", () => {
	it("gives every item an icon, with Actions, Recent threads and places at rest", async () => {
		const { ThreadSearch } = await import("./SidebarHead");
		await act(async () =>
			root.render(<ThreadSearch open onOpenChange={() => {}} />),
		);
		const items = Array.from(document.querySelectorAll("[cmdk-item]"));
		expect(items.length).toBeGreaterThan(5);
		for (const item of items)
			expect(item.firstElementChild?.tagName.toLowerCase()).toBe("svg");
		const headings = Array.from(
			document.querySelectorAll("[cmdk-group-heading]"),
		).map((g) => g.textContent);
		expect(headings).toEqual(["Actions", "Recent threads", "Go to"]);
		expect(
			document.querySelector('[data-testid="thread-search-filters"]'),
		).toBeNull();
		expect(
			document.querySelector(
				'[data-testid="thread-search-action-add-project"]',
			),
		).not.toBeNull();
	});
});

describe("the palette project search (#1020)", () => {
	it("sends the typed text to the server, so a project past the first page is found", async () => {
		const { ThreadSearch } = await import("./SidebarHead");
		await act(async () =>
			root.render(<ThreadSearch open onOpenChange={() => {}} />),
		);
		const input = document.querySelector("[cmdk-input]") as HTMLInputElement;
		const set = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set;
		h.repoArgs.length = 0;
		await act(async () => {
			set?.call(input, " sho ");
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(h.repoArgs.at(-1)).toMatchObject({ search: "sho", enabled: true });
	});
});

describe("projectOptions (#1020)", () => {
	it("keeps a picked project the loaded page does not hold", () => {
		const repos = [{ id: "r1", fullName: "shop" }];
		expect(projectOptions(repos, undefined)).toEqual([["r1", "shop"]]);
		expect(projectOptions(repos, "r1")).toEqual([["r1", "shop"]]);
		expect(projectOptions(repos, "r9")).toEqual([
			["r9", "Selected project"],
			["r1", "shop"],
		]);
	});
});

describe("feedInput (#1020)", () => {
	it("turns the filter popover's picks into the list's query", () => {
		expect(feedInput({})).toEqual({});
		const at = Date.parse("2026-11-03T12:00:00Z");
		expect(
			feedInput({
				kind: "investigation",
				section: "settled",
				repositoryId: "r1",
				since: "1d",
				sinceAt: at,
			}),
		).toEqual({
			kind: "investigation",
			section: "settled",
			repositoryId: "r1",
			since: new Date(at - 86_400_000),
		});
	});
});
