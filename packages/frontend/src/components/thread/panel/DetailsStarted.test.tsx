// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetailsStarted, STARTED_SHOWN, startedSpan } from "./DetailsStarted";

vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...props
	}: {
		children: ReactNode;
		to?: string;
		params?: Record<string, string>;
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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
	vi.useRealTimers();
});

const link = (
	n: number,
	state: "queued" | "running" | "answered" | "failed" | "stopped",
	unread = 0,
) => ({
	id: `t-${n}`,
	title: `Started ${n}`,
	link: `/threads/t-${n}`,
	state,
	unread,
	harness: null,
});

// fd1fac924 made the started list static: start order, no "Previous N" fold, no live time.
describe("DetailsStarted (#1101 cat 10)", () => {
	it("lists started threads in start order with their status marks and unread counts, and folds past five into N more", async () => {
		const started = [
			link(1, "answered"),
			link(2, "failed"),
			link(3, "running", 2),
			link(4, "queued"),
			link(5, "stopped"),
			link(6, "running"),
			link(7, "answered"),
		];
		const onFilter = vi.fn();
		const onMore = vi.fn();
		await act(async () => {
			root.render(
				<DetailsStarted
					started={started}
					onFilter={onFilter}
					onMore={onMore}
				/>,
			);
		});
		const rows = Array.from(
			container.querySelectorAll('[data-testid="details-started-row"]'),
		);
		expect(
			rows.map((r) => [
				r.querySelector('[data-testid="details-started-title"]')?.textContent,
				r.getAttribute("data-state"),
				r.querySelector("[data-status]")?.getAttribute("data-status"),
			]),
		).toEqual([
			["Started 1", "answered", "done"],
			["Started 2", "failed", "failed"],
			["Started 3", "running", "working"],
			["Started 4", "queued", "waiting"],
			["Started 5", "stopped", "done"],
		]);
		expect(
			Array.from(rows[2]?.querySelectorAll(".sr-only") ?? []).at(-1)
				?.textContent,
		).toBe("2 unread");
		expect(
			container.querySelector('[data-testid="details-started-heading"]')
				?.textContent,
		).toBe("Threads it started7");
		const more = container.querySelector<HTMLButtonElement>(
			'[data-testid="details-started-more"]',
		);
		expect(more?.textContent).toBe("2 more");
		await act(async () => {
			more?.click();
			container
				.querySelector<HTMLButtonElement>(
					'[data-testid="details-started-filter"]',
				)
				?.click();
		});
		expect(onMore).toHaveBeenCalledTimes(1);
		expect(onFilter).toHaveBeenCalledTimes(1);
		expect(
			container.querySelector('[data-testid="details-children-previous"]'),
		).toBeNull();
	});

	it("spans the heading, at most five rows and a more row", () => {
		expect(STARTED_SHOWN).toBe(5);
		expect(startedSpan(2)).toBe(3);
		expect(startedSpan(5)).toBe(6);
		expect(startedSpan(9)).toBe(7);
	});
});
