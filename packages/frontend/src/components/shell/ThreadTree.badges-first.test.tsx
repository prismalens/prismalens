// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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

// Its own file: lazy parts keep loaded code module-wide, so an earlier render would hide a lazy badge.
describe("a row's badges arrive with it (#1247 D25)", () => {
	it("draws place, branch and every badge in the row's first render, so no row grows when code lands later", () => {
		// One synchronous pass: a lazy part would draw its empty fallback here.
		const html = renderToString(
			createElement(
				DefaultAgent.Provider,
				{ value: { id: "claude-code" } },
				createElement(ThreadTreeView, {
					model: threadList([
						one(
							thread({
								id: "all",
								serviceName: "checkout-api",
								branch: "feat/x",
								harness: "codex",
								commits: 2,
								pr: { number: 9, tone: "open", count: 2 },
							} as Partial<ThreadRow>),
						),
					]),
					asks: new Map(),
					now: NOW,
					currentId: null,
				}),
			),
		);
		const drawn = [
			...html.matchAll(
				/data-testid="(row-place|row-branch|row-badge-[a-z]+)"/g,
			),
		].map((m) => m[1]);
		expect(drawn).toEqual([
			"row-place",
			"row-branch",
			"row-badge-pr",
			"row-badge-commits",
			"row-badge-agent",
		]);
	});
});
