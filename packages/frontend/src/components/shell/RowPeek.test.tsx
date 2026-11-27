// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListNode } from "@/lib/thread-list";
import { Peek } from "./RowPeek";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children?: ReactNode }) => children,
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
		lastActivityAt: "2026-11-12T11:00:00.000Z",
		lastVisitedAt: "2026-11-12T11:30:00.000Z",
		settledAt: null,
		unseen: false,
		latestText: "Opened the fix",
		projectName: null,
		titleSetBy: null,
		serviceName: null,
		section: "active",
		...over,
	}) as ThreadRow;

const node = (t: ThreadRow, alertCount?: number): ListNode => ({
	id: t.id,
	thread: t,
	info: { status: "done" },
	at: Date.parse(t.lastActivityAt),
	unit: {
		section: "active",
		incident:
			alertCount === undefined
				? null
				: {
						id: "00000000-0000-4000-8000-000000000001",
						number: 7,
						title: "Checkout slow",
						severity: "high",
						status: "investigating",
						alertCount,
					},
		threads: [t],
	} as ThreadUnit,
});

const pr = {
	number: 412,
	tone: "open" as const,
	count: 3,
	stack: [
		{ number: 412, tone: "open" as const, title: "fix: retry the payment" },
		{ number: 410, tone: "merged" as const, title: "test: cover rounding" },
	],
};

let host: HTMLDivElement;
let root: Root;
const draw = (n: ListNode, extra: { more?: string; only?: "prs" } = {}) =>
	act(() =>
		root.render(
			createElement(Peek, { node: n, now: NOW, title: "Thread", ...extra }),
		),
	);
const text = (id: string) =>
	host.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;

beforeEach(() => {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(() => {
	act(() => root.unmount());
	host.remove();
});

describe("Peek, the row's rest card", () => {
	it("says in words where the thread runs, its agent, its counts, an ask's wait, and lists its PRs with how many more", async () => {
		await draw(
			node(
				thread({
					serviceName: "checkout-api",
					harness: "claude",
					model: "opus",
					commits: 2,
					pr,
				}),
				4,
			),
			{ more: "Waiting 3m · to run the migration" },
		);
		expect(
			host
				.querySelector('[data-testid="row-place"]')
				?.getAttribute("aria-label"),
		).toBe("Service checkout-api");
		expect(text("peek-agent")).toBe("Claude · opus");
		expect(text("peek-counts")).toBe("2 commits · 4 alerts");
		expect(text("peek-ask-more")).toBe("Waiting 3m · to run the migration");
		expect(
			[...host.querySelectorAll('[data-testid="peek-prs"] li')].map(
				(li) => li.textContent,
			),
		).toEqual([
			"#412fix: retry the payment",
			"#410test: cover rounding",
			"1 more",
		]);
	});

	it("shows only the PR list when the PR badge was rested on", async () => {
		await draw(node(thread({ serviceName: "checkout-api", pr })), {
			only: "prs",
		});
		expect(
			host
				.querySelector('[data-testid="peek-prs"]')
				?.getAttribute("aria-label"),
		).toBe("3 PRs, newest #412, open");
		expect(host.querySelector('[data-testid="peek-latest"]')).toBeNull();
		expect(host.querySelector('[data-testid="row-place"]')).toBeNull();
	});

	it("leaves out the counts line with no commits and no alerts", async () => {
		await draw(node(thread({ commits: 0 })));
		expect(host.querySelector('[data-testid="peek-counts"]')).toBeNull();
		expect(text("peek-latest")).toBe("Opened the fix");
	});
});
