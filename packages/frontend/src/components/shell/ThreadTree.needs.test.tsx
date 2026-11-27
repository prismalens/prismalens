// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PendingAsk, ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { threadList } from "@/lib/thread-list";
import type { RowAskEntry } from "./RowAsk";
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
// 3d891b694: rows read who answered from the answer calls.
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

const render = (asks: ReadonlyMap<string, RowAskEntry[]> = new Map()) =>
	act(async () =>
		root.render(
			createElement(ThreadTreeView, {
				model: threadList(units),
				asks,
				now: NOW,
				currentId: null,
			}),
		),
	);

// Threads are flat siblings (#1101 decision, 2026-11-13): the starter fold b897d6ee1 added
// is gone, so each waiting thread is its own Needs-you row again (#1101 cat 1).
describe("Needs you lists each thread that waits, flat (#1101 cat 1)", () => {
	it("shows each started thread that waits on you as its own row, oldest wait first, and not its starter", async () => {
		await render();
		expect(needsRows()).toEqual(["a", "b"]);
		expect(container.querySelector('[data-testid="row-expand"]')).toBeNull();
		expect(container.querySelector('[data-testid="mark-tally"]')).toBeNull();
	});

	it("marks each agent-started row with who started it, and the starter's row with nothing", async () => {
		await render();
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

describe("an ask row's wait (#1020)", () => {
	it("reserves no line under an approval or question row: its wait lives in the row's card", async () => {
		const ask = {
			askId: "00000000-0000-4000-8000-000000000001",
			threadId: "a",
			kind: "permission",
			requiresHost: false,
			source: { kind: "agent" },
			title: "Run the migration",
			openedAt: "2026-11-12T11:58:00.000Z",
		} as PendingAsk;
		await render(new Map([["a", [{ ask, ended: false, accessLevel: null }]]]));
		expect(needsRows()).toEqual(["a", "b"]);
		expect(
			container.querySelectorAll('[data-testid="row-ask-more"]'),
		).toHaveLength(0);
		const wrap = container
			.querySelector('[data-testid="thread-row"][data-id="a"]')
			?.closest('[data-testid="thread-row-wrap"]');
		await act(async () => {
			wrap?.dispatchEvent(
				new PointerEvent("pointerover", {
					bubbles: true,
					pointerType: "mouse",
				}),
			);
		});
		await vi.waitFor(
			() =>
				expect(
					document.body.querySelector(
						'[data-testid="row-rest-card"] [data-testid="peek-ask-more"]',
					)?.textContent,
				).toBe("Waiting 2m · Asked because the agent's own mode asks first."),
			{ timeout: 3000 },
		);
	});
});
