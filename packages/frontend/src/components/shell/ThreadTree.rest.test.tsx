// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultAgent } from "@/components/kit/MarkBadges";
import { threadList } from "@/lib/thread-list";
import { ThreadTreeView } from "./ThreadTree";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	Link: ({ children, ...props }: { children?: ReactNode }) =>
		createElement("a", props, children),
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
}));
vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => ({ via: "token", managesPairing: true }),
}));

const NOW = Date.parse("2026-11-12T12:00:00.000Z");

const thread = (over: Partial<ThreadRow> & { state?: unknown }): ThreadRow =>
	({
		id: "t",
		title: "Thread",
		status: "completed",
		kind: "chat",
		origin: "local",
		schemaVersion: 1,
		createdAt: "2026-11-12T10:00:00.000Z",
		updatedAt: "2026-11-12T10:00:00.000Z",
		lastActivityAt: "2026-11-12T11:00:00.000Z",
		lastVisitedAt: "2026-11-12T11:30:00.000Z",
		settledAt: null,
		unseen: false,
		latestText: null,
		projectName: null,
		titleSetBy: null,
		serviceName: null,
		section: "active",
		...over,
	}) as ThreadRow;

const one = (t: ThreadRow): ThreadUnit => ({
	section: "active",
	incident: null,
	threads: [t],
});

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

const render = (threads: ThreadRow[]) =>
	act(async () =>
		root.render(
			createElement(
				DefaultAgent.Provider,
				{ value: { id: "claude-code" } },
				createElement(ThreadTreeView, {
					model: threadList(threads.map(one)),
					asks: new Map(),
					now: NOW,
					currentId: null,
				}),
			),
		),
	);

const wrapOf = (id: string) => {
	const wrap = container
		.querySelector(`[data-testid="thread-row"][data-id="${id}"]`)
		?.closest('[data-testid="thread-row-wrap"]');
	if (!wrap) throw new Error(`no row ${id}`);
	return wrap;
};

// A real pointer always comes from somewhere: `from` is the element it left.
const hover = (
	el: Element | null | undefined,
	type: "pointerover" | "pointerout",
	from: Element | null = null,
) =>
	act(async () => {
		el?.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				pointerType: "mouse",
				relatedTarget: from,
			}),
		);
	});
const card = (id: string) =>
	document.body.querySelector(`[data-testid="${id}"]`);

describe("resting on a row (#1020)", () => {
	const pr = {
		number: 412,
		tone: "open",
		count: 2,
		stack: [
			{ number: 412, tone: "open", title: "fix: retry the payment" },
			{ number: 410, tone: "merged", title: "test: cover rounding" },
		],
	};

	it("opens one card beside the row with its place and counts, swaps it for the PR list on the PR badge, and closes both on leaving", async () => {
		await render([
			thread({
				id: "r",
				serviceName: "checkout-api",
				commits: 3,
				pr,
				harness: "codex",
			} as Partial<ThreadRow>),
		]);
		const wrap = wrapOf("r");
		await hover(wrap, "pointerover");
		await vi.waitFor(() => expect(card("row-rest-card")).not.toBeNull(), {
			timeout: 3000,
		});
		expect(
			card("row-rest-card")?.querySelector('[data-testid="peek-counts"]')
				?.textContent,
		).toBe("3 commits");
		// The row's lazy menu wrapper redraws it once on load, so it is found again.
		const row = wrapOf("r");
		// React reads a move between its own nodes from the out event of the node left.
		await hover(
			row.querySelector('[data-testid="thread-row"]'),
			"pointerout",
			row.querySelector('[data-testid="row-badge-pr"]'),
		);
		await vi.waitFor(() => expect(card("row-pr-list")).not.toBeNull(), {
			timeout: 3000,
		});
		expect(card("row-rest-card")).toBeNull();
		expect(
			[...(card("row-pr-list")?.querySelectorAll("li") ?? [])].map(
				(li) => li.textContent,
			),
		).toEqual(["#412fix: retry the payment", "#410test: cover rounding"]);
		await hover(row, "pointerout");
		expect(card("row-pr-list")).toBeNull();
		expect(card("row-rest-card")).toBeNull();
	});

	it("opens nothing for a touch, which has no rest", async () => {
		await render([thread({ id: "t" })]);
		await act(async () => {
			wrapOf("t").dispatchEvent(
				new PointerEvent("pointerover", {
					bubbles: true,
					pointerType: "touch",
				}),
			);
			await new Promise((r) => setTimeout(r, 600));
		});
		expect(card("row-rest-card")).toBeNull();
	});
});
