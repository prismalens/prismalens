// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ReactNode } from "react";
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

const unit = (i: number): ThreadUnit => ({
	section: "active",
	incident: null,
	threads: [thread({ id: `t${i}`, title: `Thread ${i}` })],
});
const loaded = (n: number) =>
	threadList(Array.from({ length: n }, (_, i) => unit(i)));

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

const draw = (n: number, onMoreActive: () => void) =>
	act(async () =>
		root.render(
			createElement(
				QueryClientProvider,
				{ client: new QueryClient() },
				createElement(ThreadTreeView, {
					model: loaded(n),
					asks: new Map(),
					now: NOW,
					currentId: null,
					activeTotal: 104,
					onMoreActive,
				}),
			),
		),
	);
const rows = () =>
	container.querySelectorAll('[data-testid="thread-row"]').length;
const more = () =>
	container.querySelector<HTMLButtonElement>(
		'[data-testid="threads-show-more"]',
	);

describe("Show more on the thread list (#1193 bar 17.5, 17.8)", () => {
	it("asks for the next page when one arrives short of the rows asked for, until they are drawn", async () => {
		// The list ignores a page asked for while one is loading, as the feed does.
		const onMoreActive = vi.fn();
		await draw(40, onMoreActive);
		while (more()) await act(async () => more()?.click());
		const clicked = onMoreActive.mock.calls.length;

		await draw(80, onMoreActive);
		const afterPage = onMoreActive.mock.calls.length - clicked;
		await draw(104, onMoreActive);

		expect([
			clicked,
			afterPage,
			onMoreActive.mock.calls.length - clicked,
			rows(),
		]).toEqual([4, 1, 1, 104]);
	});
});
