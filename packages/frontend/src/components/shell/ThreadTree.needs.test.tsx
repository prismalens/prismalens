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

const started = (id: string, status: string, at: string): ThreadRow =>
	thread({
		id,
		title: `Started ${id}`,
		lastActivityAt: at,
		startedBy: {
			id: "root",
			title: "Starter",
			link: "/threads/root",
			via: "agent",
		},
		state: { status },
	} as Partial<ThreadRow>);

const one = (t: ThreadRow): ThreadUnit => ({
	section: "active",
	incident: null,
	threads: [t],
});
const units: ThreadUnit[] = [
	one(
		thread({
			id: "root",
			title: "Starter",
			state: { status: "working" },
		} as Partial<ThreadRow>),
	),
	one(started("a", "approval", "2026-11-12T09:00:00.000Z")),
	one(started("b", "question", "2026-11-12T10:00:00.000Z")),
	one(started("c", "working", "2026-11-12T11:00:00.000Z")),
];

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

const render = () =>
	act(async () =>
		root.render(
			createElement(ThreadTreeView, {
				model: threadList(units),
				asks: new Map(),
				now: NOW,
				currentId: null,
			}),
		),
	);

const openGroup = () =>
	act(async () =>
		(
			container.querySelector(
				'[data-testid="starter-group-toggle"]',
			) as HTMLButtonElement
		).click(),
	);

// 561805422 made the list flat; a starter's agent-started threads that need you now fold
// into one Needs-you row under the starter, which opens to them (#1101 cat 1).
describe("Needs you folds one starter's waiting threads into one row (#1101 cat 1)", () => {
	it("shows the starter's two waiting threads as one closed group, then each as its own row, oldest wait first", async () => {
		await render();
		const toggle = container.querySelector(
			'[data-testid="thread-section-needs"] [data-testid="starter-group-toggle"]',
		);
		expect(toggle?.getAttribute("aria-expanded")).toBe("false");
		expect(
			container.querySelector('[data-testid="starter-group-line"]')
				?.textContent,
		).toBe("2 threads it started need you");
		expect(needsRows()).toEqual([]);
		await openGroup();
		expect(needsRows()).toEqual(["a", "b"]);
		expect(container.querySelector('[data-testid="row-expand"]')).toBeNull();
		expect(container.querySelector('[data-testid="mark-tally"]')).toBeNull();
	});

	it("marks each agent-started row with who started it, and the starter's row with nothing", async () => {
		await render();
		await openGroup();
		const marks = Array.from(
			container.querySelectorAll('[data-testid="thread-row"]'),
		).map((r) => [
			r.getAttribute("data-id"),
			r
				.querySelector('[data-testid="mark-started-by"]')
				?.getAttribute("aria-label") ?? null,
		]);
		expect(marks).toEqual([
			["a", "Started by Starter"],
			["b", "Started by Starter"],
			["c", "Started by Starter"],
			["root", null],
		]);
	});
});
