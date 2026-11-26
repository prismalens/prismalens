// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListNode } from "@/lib/thread-list";
import { threadList } from "@/lib/thread-list";
import { ThreadTreeView, type TreeProps } from "./ThreadTree";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	Link: ({ children, ...props }: { children?: ReactNode }) =>
		createElement("a", { ...props, href: "#" }, children),
}));
vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("@/components/shell/ThreadMenu", () => ({
	ThreadContextMenu: ({ children }: { children?: ReactNode }) => children,
	ThreadMenu: () => null,
}));
vi.mock("@/lib/api/hooks/use-investigations-orpc", () => ({
	useAnswerAsk: () => ({ mutate: vi.fn(), isPending: false }),
	useAnsweredHere: () => [],
	useResumeInvestigation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api/hooks/use-session-orpc", () => ({
	useRetryNow: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => ({ via: "token", managesPairing: true }),
}));

const NOW = Date.parse("2026-11-12T12:00:00.000Z");

const unit = (id: string, status: string, at: string): ThreadUnit => ({
	section: "active",
	incident: null,
	threads: [
		{
			id,
			title: `Thread ${id}`,
			status: "completed",
			kind: "chat",
			origin: "local",
			schemaVersion: 1,
			createdAt: "2026-11-12T10:00:00.000Z",
			updatedAt: "2026-11-12T10:00:00.000Z",
			lastActivityAt: at,
			lastVisitedAt: at,
			settledAt: null,
			unseen: false,
			latestText: null,
			projectName: null,
			titleSetBy: null,
			serviceName: null,
			section: "active",
			state: { status },
		} as unknown as ThreadRow,
	],
});

const units = [
	unit("q1", "question", "2026-11-12T09:00:00.000Z"),
	unit("q2", "approval", "2026-11-12T09:30:00.000Z"),
	unit("w", "working", "2026-11-12T11:00:00.000Z"),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	localStorage.clear();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

const draw = (over: Partial<TreeProps> = {}, needsCount?: number) =>
	act(async () =>
		root.render(
			createElement(ThreadTreeView, {
				model: threadList(units, needsCount),
				asks: new Map(),
				now: NOW,
				currentId: null,
				...over,
			}),
		),
	);
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const needsIds = () =>
	Array.from(
		container.querySelectorAll(
			'[data-testid="thread-section-needs"] [data-testid="thread-row"]',
		),
	).map((r) => r.getAttribute("data-id"));
const onlyWorking = (n: ListNode) => n.info.status === "working";
const onlyQ1 = (n: ListNode) => n.id === "q1";

describe("a filter never strands Needs you (#1247 D25)", () => {
	it("says how many of the 28 match and offers Show all, which lists every waiting row", async () => {
		const onShowAllNeeds = vi.fn();
		await draw({ filter: onlyQ1, onShowAllNeeds }, 28);
		expect(q("thread-section-needs-count")?.textContent).toBe("1 of 28");
		expect(needsIds()).toEqual(["q1"]);
		(q("needs-show-all") as HTMLButtonElement).click();
		expect(onShowAllNeeds).toHaveBeenCalledTimes(1);
		await draw({ filter: onlyQ1, onShowAllNeeds, needsAll: true }, 28);
		expect(q("thread-section-needs-count")?.textContent).toBe("28");
		expect(needsIds()).toEqual(["q1", "q2"]);
		expect(q("needs-show-all")).toBeNull();
	});

	it("keeps the heading at 0 of 28 when the filter matches no waiting row", async () => {
		await draw({ filter: onlyWorking, onShowAllNeeds: vi.fn() }, 28);
		expect(q("thread-section-needs-count")?.textContent).toBe("0 of 28");
		expect(needsIds()).toEqual([]);
		expect(q("needs-show-all")?.textContent).toBe("Show all");
	});
});

describe("Needs you past the first page (#1247 D25)", () => {
	it("offers Show 43 more when the server counts 45 and 2 loaded, and asks for the next page", async () => {
		const onMoreNeeds = vi.fn();
		await draw({ onMoreNeeds }, 45);
		expect(q("needs-show-more")?.textContent).toBe("Show 43 more");
		(q("needs-show-more") as HTMLButtonElement).click();
		expect(onMoreNeeds).toHaveBeenCalledTimes(1);
	});

	it("offers no more when every waiting row loaded", async () => {
		await draw({ onMoreNeeds: vi.fn() }, 2);
		expect(q("needs-show-more")).toBeNull();
	});
});

describe("the Needs you bar keeps the count on screen once the heading scrolls away (#1247 D25)", () => {
	const scrolled = async (headBottom: number) => {
		const scroller = document.createElement("div");
		scroller.style.overflowY = "auto";
		container.replaceWith(scroller);
		scroller.appendChild(container);
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			function (this: HTMLElement) {
				const top =
					this === scroller ? 100 : this.tagName === "H2" ? headBottom - 28 : 0;
				const bottom =
					this === scroller ? 700 : this.tagName === "H2" ? headBottom : 0;
				return {
					top,
					bottom,
					left: 0,
					right: 0,
					width: 0,
					height: 0,
					x: 0,
					y: top,
					toJSON: () => ({}),
				} as DOMRect;
			},
		);
		return scroller;
	};

	it("shows no bar while the heading is in view", async () => {
		await scrolled(140);
		await draw({}, 28);
		expect(q("needs-bar")).toBeNull();
	});

	it("shows the full count once the heading is above the list, and a click focuses the first waiting row", async () => {
		const scroller = await scrolled(60);
		await draw({ filter: onlyQ1, onShowAllNeeds: vi.fn() }, 28);
		const bar = q("needs-bar") as HTMLButtonElement;
		expect(q("needs-bar-count")?.textContent).toBe("28");
		expect(bar.getAttribute("aria-label")).toBe(
			"Needs you, 28. Go to the first",
		);
		const frame = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((cb) => {
				cb(0);
				return 0;
			});
		HTMLElement.prototype.scrollIntoView = vi.fn();
		await act(async () => bar.click());
		expect(frame).toHaveBeenCalledTimes(1);
		expect(document.activeElement?.getAttribute("data-id")).toBe("q1");
		scroller.remove();
	});

	it("asks for Show all before jumping when the filter left Needs you empty", async () => {
		await scrolled(60);
		const onShowAllNeeds = vi.fn();
		await draw({ filter: onlyWorking, onShowAllNeeds }, 28);
		vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
		await act(async () => (q("needs-bar") as HTMLButtonElement).click());
		expect(onShowAllNeeds).toHaveBeenCalledTimes(1);
	});
});

describe("a held row says where it goes (#1247 D25)", () => {
	it("replaces its second line with Moves to Needs you, and keeps a row without one at one line", async () => {
		const withLine = [
			...units.slice(0, 2),
			{
				...units[2],
				threads: [
					{ ...units[2].threads[0], latestText: "Reading the proxy logs" },
				],
			} as ThreadUnit,
		];
		await draw({
			model: threadList(withLine),
			moving: new Map([
				["w", "needs"],
				["q1", "active"],
			]),
		});
		const moved = container.querySelector('[data-moving="needs"]');
		expect(
			moved
				?.querySelector('[data-testid="thread-row"]')
				?.getAttribute("data-id"),
		).toBe("w");
		expect(
			moved?.querySelector('[data-testid="row-moving"]')?.textContent,
		).toBe("Moves to Needs you");
		expect(moved?.querySelector('[data-testid="row-detail"]')).toBeNull();
		const bare = container.querySelector('[data-moving="active"]');
		expect(bare?.querySelector('[data-testid="row-meta"]')).toBeNull();
	});
});

describe("Settled remembers whether it is open (#1247 D25)", () => {
	it("opens from what this device stored, and stores a close", async () => {
		localStorage.setItem("pl.threads.settledOpen", "1");
		const settled = threadList(
			[
				{
					...unit("s", "done", "2026-11-12T08:00:00.000Z"),
					section: "settled",
				},
			],
			0,
			1,
		);
		await draw({ model: settled });
		const toggle = q("settled-toggle") as HTMLButtonElement;
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		await act(async () => toggle.click());
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(localStorage.getItem("pl.threads.settledOpen")).toBe("0");
	});
});
