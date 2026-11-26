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

// The incident's unit is active while one of its threads is; the other stays settled.
const mixed: ThreadUnit = {
	section: "active",
	incident: {
		id: "00000000-0000-4000-8000-000000000001",
		number: 7,
		title: "Checkout errors",
		severity: "high",
		status: "investigating",
	},
	threads: [
		thread({ id: "open", title: "Open" }),
		thread({
			id: "done",
			title: "Done",
			section: "settled",
			settledAt: "2026-11-12T11:00:00.000Z",
		}),
	],
};

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

describe("a row's Settle control reads the thread's own state, as its menu does", () => {
	it("offers Settle on the incident's open thread and not on its settled one", async () => {
		await act(async () =>
			root.render(
				createElement(
					QueryClientProvider,
					{ client: new QueryClient() },
					createElement(ThreadTreeView, {
						model: threadList([mixed]),
						asks: new Map(),
						now: NOW,
						currentId: null,
						onSettle: () => {},
					}),
				),
			),
		);
		const settles = Array.from(
			container.querySelectorAll('[data-testid="thread-row"]'),
		).map((r) => [
			r.getAttribute("data-id"),
			!!r
				.closest('[data-testid="thread-row-wrap"]')
				?.querySelector('[data-testid="thread-settle"]'),
		]);
		expect(settles).toEqual([
			["open", true],
			["done", false],
		]);
	});
});
