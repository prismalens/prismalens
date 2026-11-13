// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow, ThreadUnit } from "@prismalens/contracts";
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
		kind: "chat",
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

const child = (id: string, status: string): ThreadRow =>
	thread({
		id,
		title: `Child ${id}`,
		tree: { rootId: "root", parentId: "root", role: null, depth: 1 },
		state: { status },
	} as Partial<ThreadRow>);

const unit: ThreadUnit = {
	section: "active",
	incident: null,
	threads: [
		thread({
			id: "root",
			title: "Tree root",
			state: { status: "working" },
		} as Partial<ThreadRow>),
		child("a", "approval"),
		child("b", "question"),
		child("c", "working"),
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

const needsRows = () =>
	Array.from(
		container.querySelectorAll(
			'[data-testid="thread-section-needs"] [data-testid="thread-row"]',
		),
	).map((r) => r.getAttribute("data-id"));

// cbb0188ec folded Needs-you roots and gave them a tally of their tree's states.
describe("Needs you lists roots, folded (#1101 F2)", () => {
	it("shows the root alone, not the children that wait on you", async () => {
		await act(async () =>
			root.render(
				createElement(ThreadTreeView, {
					model: threadList([unit]),
					asks: new Map(),
					now: NOW,
					currentId: null,
				}),
			),
		);
		expect(needsRows()).toEqual(["root"]);
	});

	it("opens the two waiting children under the root from its toggle", async () => {
		await act(async () =>
			root.render(
				createElement(ThreadTreeView, {
					model: threadList([unit]),
					asks: new Map(),
					now: NOW,
					currentId: null,
				}),
			),
		);
		const toggle = container.querySelector(
			'[data-testid="thread-section-needs"] [data-testid="row-expand"]',
		) as HTMLButtonElement;
		expect(toggle.getAttribute("aria-label")).toBe("Expand 2 threads");
		await act(async () => toggle.click());
		expect(needsRows()).toEqual(["root", "a", "b"]);
	});

	it("tallies the tree as one approval, one question and two working", async () => {
		await act(async () =>
			root.render(
				createElement(ThreadTreeView, {
					model: threadList([unit]),
					asks: new Map(),
					now: NOW,
					currentId: null,
				}),
			),
		);
		const tally = container.querySelector(
			'[data-testid="thread-section-needs"] [data-testid="mark-tally"]',
		);
		const counts = Array.from(
			tally?.querySelectorAll("[data-state]") ?? [],
		).map((s) => `${s.getAttribute("data-state")} ${s.textContent}`);
		expect(counts).toEqual(["approval 1", "question 1", "working 2"]);
		expect(tally?.getAttribute("aria-label")).toBe(
			"3 threads started from it: 2 need you, 2 working",
		);
	});
});
