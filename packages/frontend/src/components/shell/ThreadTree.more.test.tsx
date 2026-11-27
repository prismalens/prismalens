// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ReactNode, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const thread = (over: Partial<ThreadRow>): ThreadRow =>
	({
		id: "t",
		title: "Thread",
		status: "completed",
		kind: "investigation",
		origin: "local",
		schemaVersion: 1,
		createdAt: "2026-11-12T10:00:00.000Z",
		updatedAt: "2026-11-12T10:00:00.000Z",
		lastActivityAt: "2026-11-12T10:00:00.000Z",
		lastVisitedAt: "2026-11-12T10:00:00.000Z",
		settledAt: null,
		unseen: false,
		latestText: null,
		projectName: null,
		titleSetBy: null,
		serviceName: null,
		section: "active",
		...over,
	}) as ThreadRow;

const unit = (
	i: number,
	section: "active" | "settled" = "active",
): ThreadUnit => ({
	section,
	incident: null,
	threads: [
		thread({
			id: `${section}-${i}`,
			title: `Thread ${i}`,
			section,
			...(section === "settled"
				? { settledAt: "2026-11-12T09:00:00.000Z" }
				: {}),
		}),
	],
});
const page = (n: number, from: number, section?: "active" | "settled") =>
	Array.from({ length: n }, (_, i) => unit(from + i, section));

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

/** The feed as ThreadList runs it: a request while a page loads is dropped, and none past the last.
 * A requested page lands only when the test calls `land`. */
const feed = { asked: false, land: () => {} };
function Feed({
	pages,
	total,
}: {
	pages: ThreadUnit[][];
	total: number | undefined;
}) {
	const [n, setN] = useState(1);
	const fetching = useRef(false);
	feed.land = () => {
		if (!fetching.current) return;
		fetching.current = false;
		feed.asked = false;
		setN((k) => k + 1);
	};
	const more = () => {
		if (fetching.current || n >= pages.length) return;
		fetching.current = true;
		feed.asked = true;
	};
	return createElement(ThreadTreeView, {
		model: threadList(pages.slice(0, n).flat()),
		asks: new Map(),
		now: NOW,
		currentId: null,
		activeTotal: total,
		pages: n,
		hasMoreActive: n < pages.length,
		onMoreActive: more,
	});
}

const draw = (pages: ThreadUnit[][], total: number | undefined) =>
	act(async () =>
		root.render(
			createElement(
				QueryClientProvider,
				{ client: new QueryClient() },
				createElement(Feed, { pages, total }),
			),
		),
	);
const rows = () =>
	container.querySelectorAll(
		'[data-testid="thread-section-threads"] [data-testid="thread-row"]',
	).length;
const more = () =>
	container.querySelector<HTMLButtonElement>(
		'[data-testid="threads-show-more"]',
	);
/** Presses Show more until it leaves while the first page it asked for loads, then lands each page asked for. */
const showAll = async () => {
	for (let i = 0; i < 10 && more(); i++) await act(async () => more()?.click());
	for (let i = 0; i < 10 && feed.asked; i++) await act(async () => feed.land());
};

describe("Show more on the thread list (#1193 bar 17.5, 17.8)", () => {
	it("draws every active row asked for though Show more is pressed while pages load", async () => {
		await draw([page(40, 0), page(40, 40), page(24, 80)], 104);
		await showAll();
		expect([rows(), more()]).toEqual([104, null]);
	});

	it("asks for the page after one that brings no active row", async () => {
		await draw(
			[page(40, 0), page(40, 0, "settled"), page(40, 40), page(24, 80)],
			104,
		);
		await showAll();
		expect([rows(), more()]).toEqual([104, null]);
	});

	it("keeps loading toward the rows asked for when the list has no total", async () => {
		await draw([page(35, 0), page(35, 0, "settled"), page(35, 35)], undefined);
		await act(async () => more()?.click());
		for (let i = 0; i < 10 && feed.asked; i++)
			await act(async () => feed.land());
		expect(rows()).toBe(40);
	});

	it("keeps an unnumbered Show more while another page exists when the list has no total, until every row shows", async () => {
		// Each page ends where Show more stops, so no loaded row is left to count.
		await draw([page(15, 0), page(25, 15), page(25, 40)], undefined);
		for (let i = 0; i < 30 && (more() || feed.asked); i++) {
			await act(async () => more()?.click());
			await act(async () => feed.land());
		}
		expect([rows(), more()]).toEqual([65, null]);
	});

	it("labels Show more without a count while the list has no total", async () => {
		await draw([page(35, 0), page(35, 35)], undefined);
		expect(more()?.textContent).toBe("Show more");
	});
});
