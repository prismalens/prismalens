// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SubagentSummary, ThreadLink } from "@prismalens/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetailsStarted, startedItems } from "./DetailsStarted";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		params,
		...props
	}: {
		children: ReactNode;
		to?: string;
		params?: Record<string, string>;
	}) => {
		let href = to ?? "";
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				href = href.replace(`$${k}`, v);
			}
		}
		return (
			<a href={href} {...props}>
				{children}
			</a>
		);
	},
}));

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

async function show(ui: React.ReactNode) {
	await act(async () => {
		root.render(ui);
	});
}

describe("DetailsStarted (#1176)", () => {
	it("orders rows: failed first, then running, then finished folded under Finished {n}", async () => {
		const started: ThreadLink[] = [
			{
				id: "t-finished",
				title: "Finished Thread",
				link: "/threads/t-finished",
				state: "answered",
				unread: 0,
				via: "agent",
				startedAt: "2026-11-18T00:00:00Z",
				endedAt: "2026-11-18T00:05:00Z",
			},
			{
				id: "t-running",
				title: "Running Thread",
				link: "/threads/t-running",
				state: "running",
				unread: 0,
				via: "fork",
				startedAt: "2026-11-18T00:00:00Z",
			},
		];

		const subagents: SubagentSummary[] = [
			{
				sessionId: "sub-failed",
				parentSessionId: null,
				title: "Failed Subagent",
				state: "failed",
				startedAt: "2026-11-18T00:00:00Z",
				endedAt: "2026-11-18T00:01:00Z",
			},
			{
				sessionId: "sub-finished",
				parentSessionId: null,
				title: "Done Subagent",
				state: "completed",
				startedAt: "2026-11-18T00:00:00Z",
				endedAt: "2026-11-18T00:02:00Z",
			},
		];

		await show(
			<DetailsStarted
				started={started}
				subagents={subagents}
				harness="mock-agent"
			/>,
		);

		// Initially visible rows: failed first, then running
		const initialRows = container.querySelectorAll(
			'[data-testid="started-row"]',
		);
		expect(initialRows).toHaveLength(2);
		expect(initialRows[0]?.getAttribute("data-id")).toBe("sub-failed");
		expect(initialRows[0]?.getAttribute("data-state")).toBe("failed");
		expect(initialRows[1]?.getAttribute("data-id")).toBe("t-running");
		expect(initialRows[1]?.getAttribute("data-state")).toBe("running");

		// Finished {n} toggle
		const toggle = container.querySelector<HTMLButtonElement>(
			'[data-testid="started-finished-toggle"]',
		);
		expect(toggle).not.toBeNull();
		expect(toggle?.textContent).toContain("Finished 2");

		// Clicking toggle expands finished rows
		await act(async () => {
			toggle?.click();
		});

		const allRows = container.querySelectorAll('[data-testid="started-row"]');
		expect(allRows).toHaveLength(4);
		expect(allRows[2]?.getAttribute("data-id")).toBe("t-finished");
		expect(allRows[2]?.getAttribute("data-state")).toBe("finished");
		expect(allRows[3]?.getAttribute("data-id")).toBe("sub-finished");
		expect(allRows[3]?.getAttribute("data-state")).toBe("finished");
	});

	it("shows elapsed time for running and duration for finished", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-11-18T00:10:00Z"));

		const started: ThreadLink[] = [
			{
				id: "t-run",
				title: "Running Task",
				link: "/threads/t-run",
				state: "running",
				unread: 0,
				via: "fix",
				startedAt: "2026-11-18T00:06:00Z", // 4m ago
			},
			{
				id: "t-done",
				title: "Finished Task",
				link: "/threads/t-done",
				state: "answered",
				unread: 0,
				via: "side",
				startedAt: "2026-11-18T00:00:00Z",
				endedAt: "2026-11-18T00:02:30Z", // 2m 30s
			},
		];

		await show(<DetailsStarted started={started} subagents={[]} />);

		// Open finished fold
		const toggle = container.querySelector<HTMLButtonElement>(
			'[data-testid="started-finished-toggle"]',
		);
		await act(async () => {
			toggle?.click();
		});

		const rows = container.querySelectorAll('[data-testid="started-row"]');
		expect(rows).toHaveLength(2);

		// Running row: elapsed time (4m)
		expect(rows[0]?.textContent).toContain("4m");

		// Finished row: duration (2m 30s)
		expect(rows[1]?.textContent).toContain("2m 30s");
	});

	it("renders a thread row as link to /threads/$id and a sub-agent row as button calling onOpenSubagent", async () => {
		const onOpenSubagent = vi.fn();
		const started: ThreadLink[] = [
			{
				id: "thread-xyz",
				title: "Child Thread",
				link: "/threads/thread-xyz",
				state: "running",
				unread: 0,
				via: "agent",
			},
		];
		const subagents: SubagentSummary[] = [
			{
				sessionId: "sess-abc",
				parentSessionId: null,
				title: "Helper subagent",
				state: "running",
				startedAt: "2026-11-18T00:00:00Z",
				endedAt: null,
			},
		];

		await show(
			<DetailsStarted
				started={started}
				subagents={subagents}
				onOpenSubagent={onOpenSubagent}
			/>,
		);

		const threadRow = container.querySelector<HTMLAnchorElement>(
			'a[data-testid="started-row"][data-kind="thread"]',
		);
		expect(threadRow).not.toBeNull();
		expect(threadRow?.getAttribute("href")).toBe("/threads/thread-xyz");

		const subagentRow = container.querySelector<HTMLButtonElement>(
			'button[data-testid="started-row"][data-kind="subagent"]',
		);
		expect(subagentRow).not.toBeNull();

		await act(async () => {
			subagentRow?.click();
		});

		expect(onOpenSubagent).toHaveBeenCalledTimes(1);
		expect(onOpenSubagent).toHaveBeenCalledWith("sess-abc");
	});
});
