// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PendingAsk, ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RowAskEntry } from "@/components/shell/RowAsk";
import { threadList } from "@/lib/thread-list";
import { HomeNeeds } from "./HomeHandover";

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
});

const cards = () =>
	Array.from(container.querySelectorAll('[data-testid="home-needs-card"]')).map(
		(c) => c.querySelector("[data-card-title]")?.textContent,
	);

// 869f02a4e put the trees that need you on Home, answerable in place.
describe("Home's Needs you (#1101 F3)", () => {
	it("shows six cards, then Show N more opens the rest", async () => {
		const model = threadList(
			Array.from({ length: 8 }, (_, i) => unit(thread(`n${i}`, "approval"))),
		);
		await act(async () =>
			root.render(
				createElement(HomeNeeds, {
					needs: model.needs,
					count: model.needsCount,
					asks: new Map(),
					now: NOW,
				}),
			),
		);
		expect(cards()).toHaveLength(6);
		const more = container.querySelector(
			'[data-testid="home-needs-more"]',
		) as HTMLButtonElement;
		expect(more.textContent).toBe("Show 2 more");
		await act(async () => more.click());
		expect(cards()).toHaveLength(8);
	});

	// 546388e43: the card's one fix is Answer, which opens the ask beside it.
	it("answers a waiting permission with Approve from the card's Answer", async () => {
		const model = threadList([unit(thread("p", "approval"))]);
		await act(async () =>
			root.render(
				createElement(HomeNeeds, {
					needs: model.needs,
					count: model.needsCount,
					asks: new Map([["p", [permission("p")]]]),
					now: NOW,
				}),
			),
		);
		const fix = container.querySelector(
			'[data-testid="home-fix"]',
		) as HTMLButtonElement;
		expect(fix.dataset.fix).toBe("answer");
		await act(async () => fix.click());
		const approve = Array.from(
			document.querySelectorAll('[data-testid="home-ask-card"] button'),
		).find((b) => b.textContent === "Approve") as HTMLButtonElement;
		await act(async () => approve.click());
		expect(answer.mock.calls[0]?.[0]).toEqual({
			id: "p",
			askId: "ask-p",
			answer: { kind: "permission", decision: "approve", scope: "once" },
		});
	});

	it("draws nothing when nothing needs you", async () => {
		await act(async () =>
			root.render(
				createElement(HomeNeeds, {
					needs: [],
					count: 0,
					asks: new Map(),
					now: NOW,
				}),
			),
		);
		expect(container.querySelector('[data-testid="home-needs"]')).toBeNull();
	});
});
