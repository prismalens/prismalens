// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PendingAsk, ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RowAskEntry } from "@/components/shell/RowAsk";
import type { ThreadListModel } from "@/lib/thread-list";
import { threadList } from "@/lib/thread-list";
import { NeedsBadge, NeedsBadgePart } from "./NeedsBadge";
import { NeedsList } from "./NeedsList";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const answer = vi.fn();
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	Link: ({ children, ...props }: { children?: ReactNode }) =>
		createElement("a", props, children),
}));
vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("@/lib/api/hooks/use-investigations-orpc", () => ({
	useAnswerAsk: () => ({ mutate: answer, isPending: false }),
	// The Interrupted card's Resume (`needs.resume`).
	useResumeInvestigation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api/hooks/use-session-orpc", () => ({
	useRetryNow: () => ({ mutate: vi.fn(), isPending: false }),
}));
let listed: ThreadListModel;
vi.mock("@/components/shell/ThreadList", () => ({
	useThreadListModel: () => ({ model: listed }),
	useAsksByThread: () => new Map(),
}));
vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => ({ via: "token", managesPairing: true }),
}));

const NOW = Date.parse("2026-11-12T12:00:00.000Z");

const thread = (id: string, status: string): ThreadRow =>
	({
		id,
		title: `Thread ${id}`,
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
		state: { status },
	}) as unknown as ThreadRow;

const unit = (t: ThreadRow): ThreadUnit => ({
	section: "active",
	incident: null,
	threads: [t],
});

const permission = (threadId: string): RowAskEntry => ({
	ask: {
		askId: `ask-${threadId}`,
		threadId,
		kind: "permission",
		title: "Run kubectl rollout restart",
		openedAt: "2026-11-12T11:00:00.000Z",
		source: { kind: "agent" },
	} as unknown as PendingAsk,
	ended: false,
	accessLevel: null,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	answer.mockReset();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
});

const list = (
	needs: ThreadListModel["needs"],
	asks = new Map<string, RowAskEntry[]>(),
) =>
	act(async () =>
		root.render(createElement(NeedsList, { needs, asks, now: NOW })),
	);
const tiers = () =>
	Array.from(document.querySelectorAll('[data-testid="needs-tier"]')).map(
		(t) => ({
			label: t.getAttribute("aria-label"),
			rows: Array.from(t.querySelectorAll('[data-testid="needs-row"]')).map(
				(r) => r.getAttribute("data-id"),
			),
		}),
	);

describe("the Needs you list groups waiting threads by the status registry's urgency (#1247 D25)", () => {
	it("puts asks first, then Interrupted and Blocked, each tier headed by its icons and its count", async () => {
		const model = threadList([
			unit(thread("i", "interrupted")),
			unit(thread("q", "question")),
			unit(thread("b", "blocked")),
			unit(thread("a", "approval")),
		]);
		await list(model.needs);
		expect(tiers()).toEqual([
			{ label: "Question, Approval needed: 2", rows: ["q", "a"] },
			{ label: "Interrupted, Blocked: 2", rows: ["i", "b"] },
		]);
	});

	it("words a row's status and its ask beside the title", async () => {
		const model = threadList([unit(thread("p", "approval"))]);
		await list(model.needs, new Map([["p", [permission("p")]]]));
		const row = container.querySelector(
			'[data-testid="needs-row"]',
		) as HTMLElement;
		expect(row.querySelector("[data-fact=title]")?.textContent).toBe(
			"Thread p",
		);
		expect(row.querySelector("[data-status=approval]")?.textContent).toBe(
			"Approval needed",
		);
		expect(row.querySelector("[data-fact=cause]")?.textContent).toBe(
			"Run kubectl rollout restart",
		);
	});

	// 546388e43: the row's one fix is Answer, which opens the ask beside it.
	it("answers a waiting permission with Approve from the row's Answer", async () => {
		const model = threadList([unit(thread("p", "approval"))]);
		await list(model.needs, new Map([["p", [permission("p")]]]));
		const fix = container.querySelector(
			'[data-testid="needs-fix"]',
		) as HTMLButtonElement;
		expect(fix.dataset.fix).toBe("answer");
		await act(async () => fix.click());
		const approve = Array.from(
			document.querySelectorAll('[data-testid="needs-ask-card"] button'),
		).find((b) => b.textContent === "Approve") as HTMLButtonElement;
		await act(async () => approve.click());
		expect(answer.mock.calls[0]?.[0]).toEqual({
			id: "p",
			askId: "ask-p",
			answer: { kind: "permission", decision: "approve", scope: "once" },
		});
	});
});

describe("the Needs you badge (#1247 D25)", () => {
	const badge = () =>
		container.querySelector('[data-testid="badge"]') as HTMLButtonElement;
	const draw = () =>
		act(async () =>
			root.render(createElement(NeedsBadge, { testId: "badge" })),
		);

	it("shows the count with the most urgent status, and nothing when nothing waits", async () => {
		listed = threadList(
			[unit(thread("i", "interrupted")), unit(thread("q", "question"))],
			9,
		);
		await draw();
		expect(badge().textContent).toBe("9");
		expect(badge().getAttribute("aria-label")).toBe("9 waiting for you");
		expect(badge().dataset.urgent).toBe("question");
		listed = threadList([]);
		await draw();
		expect(badge()).toBeNull();
	});

	it("previews the grouped list on hover, closes when the pointer leaves, and stays open after a click", async () => {
		vi.useFakeTimers();
		listed = threadList([
			unit(thread("q", "question")),
			unit(thread("i", "interrupted")),
		]);
		// The popover's code loads after the first paint; here it is in before the badge draws.
		await NeedsBadgePart.preload(true);
		await draw();
		const popover = () =>
			document.querySelector(
				'[data-testid="needs-popover"][data-state="open"]',
			);
		await act(async () => {
			badge().dispatchEvent(
				new PointerEvent("pointerover", {
					bubbles: true,
					pointerType: "mouse",
				}),
			);
			vi.advanceTimersByTime(150);
		});
		expect(
			popover()?.querySelectorAll('[data-testid="needs-row"]').length,
		).toBe(2);
		await act(async () => {
			badge().dispatchEvent(
				new PointerEvent("pointerout", {
					bubbles: true,
					pointerType: "mouse",
					relatedTarget: document.body,
				}),
			);
			vi.advanceTimersByTime(150);
		});
		expect(popover()).toBeNull();
		await act(async () => badge().click());
		await act(async () => {
			badge().dispatchEvent(
				new PointerEvent("pointerout", {
					bubbles: true,
					pointerType: "mouse",
					relatedTarget: document.body,
				}),
			);
			vi.advanceTimersByTime(150);
		});
		expect(
			popover()?.querySelectorAll('[data-testid="needs-tier"]').length,
		).toBe(2);
	});
});
