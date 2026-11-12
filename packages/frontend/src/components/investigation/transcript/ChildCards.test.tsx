// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadTree, ThreadTreeNode } from "@prismalens/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatClock } from "@/lib/format-time";
import {
	ChildFinishedCard,
	ChildRow,
	ParentBar,
	ThreadMessageCard,
} from "./ChildCards";

let mockTreeData: ThreadTree | null = null;

vi.mock("@/lib/api/hooks/use-thread-tree-orpc", () => ({
	useThreadTree: () => ({
		data: mockTreeData,
	}),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		params,
		className,
		"data-testid": testId,
	}: {
		children: ReactNode;
		to: string;
		params?: Record<string, string>;
		className?: string;
		"data-testid"?: string;
	}) => {
		const href = params?.id ? to.replace("$id", params.id) : to;
		return (
			<a href={href} className={className} data-testid={testId}>
				{children}
			</a>
		);
	},
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
	mockTreeData = null;
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("ChildRow (#1101)", () => {
	it("renders state word, unread count, and last step only when running", async () => {
		const nodeRunning: ThreadTreeNode = {
			id: "t-worker-1",
			number: 2,
			title: "Database Worker",
			role: "worker",
			parentId: "t-root",
			depth: 1,
			state: "running",
			unread: 2,
			lastStep: "SELECT count(*) FROM users",
			link: "/threads/t-worker-1",
		};

		await act(async () => {
			root.render(
				<ChildRow
					node={nodeRunning}
					fallbackTitle="Worker"
					threadRole="worker"
				/>,
			);
		});

		expect(
			container.querySelector('[data-testid="child-state"]')?.textContent,
		).toBe("Working");
		expect(
			container.querySelector('[data-testid="child-unread"]')?.textContent,
		).toBe("2 unread");
		expect(
			container.querySelector('[data-testid="child-last-step"]')?.textContent,
		).toBe("SELECT count(*) FROM users");

		// When not running (e.g. answered), lastStep is not rendered
		const nodeAnswered: ThreadTreeNode = {
			...nodeRunning,
			state: "answered",
			lastStep: "Finished query",
		};
		await act(async () => {
			root.render(
				<ChildRow
					node={nodeAnswered}
					fallbackTitle="Worker"
					threadRole="worker"
				/>,
			);
		});
		expect(
			container.querySelector('[data-testid="child-state"]')?.textContent,
		).toBe("Done");
		expect(
			container.querySelector('[data-testid="child-last-step"]'),
		).toBeNull();
	});
});

describe("ThreadMessageCard (#1101)", () => {
	it("renders data-direction sent/received, To/From labels, and Show all toggle for long text", async () => {
		mockTreeData = {
			rootId: "t-root",
			allowance: null,
			nodes: [
				{
					id: "t-worker-1",
					number: 2,
					title: "Worker One",
					role: "worker",
					parentId: "t-root",
					depth: 1,
					state: "running",
					unread: 0,
					link: "/threads/t-worker-1",
				},
			],
		};

		const longText = "First line of long message\n" + "x".repeat(300);

		// Sent message with long text
		await act(async () => {
			root.render(
				<ThreadMessageCard
					event={
						{
							kind: "thread_message",
							runId: "t-root",
							direction: "sent",
							peerId: "t-worker-1",
							peerLink: "/threads/t-worker-1",
							peerRole: "worker",
							type: "instruction",
							text: longText,
							ts: "2026-11-12T04:00:00Z",
						} as never
					}
				/>,
			);
		});

		const sentCard = container.querySelector('[data-testid="tree-message"]');
		expect(sentCard?.getAttribute("data-direction")).toBe("sent");
		expect(sentCard?.textContent).toContain("To");
		expect(sentCard?.textContent).toContain("Worker One");

		const expandBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="tree-message-expand"]',
		);
		expect(expandBtn?.textContent).toBe("Show all");

		// Click to expand
		await act(async () => {
			expandBtn?.click();
		});
		expect(expandBtn?.textContent).toBe("Show less");

		// Received message
		await act(async () => {
			root.render(
				<ThreadMessageCard
					event={
						{
							kind: "thread_message",
							runId: "t-root",
							direction: "received",
							peerId: "t-worker-1",
							peerLink: "/threads/t-worker-1",
							peerRole: "worker",
							type: "response",
							text: "Short reply",
							ts: "2026-11-12T04:05:00Z",
						} as never
					}
				/>,
			);
		});

		const receivedCard = container.querySelector(
			'[data-testid="tree-message"]',
		);
		expect(receivedCard?.getAttribute("data-direction")).toBe("received");
		expect(receivedCard?.textContent).toContain("From");
		expect(
			container.querySelector('[data-testid="tree-message-expand"]'),
		).toBeNull();
	});
});

describe("ChildFinishedCard (#1101)", () => {
	it("renders outcome word answered, excerpt, and link text Read the answer", async () => {
		mockTreeData = {
			rootId: "t-root",
			allowance: null,
			nodes: [
				{
					id: "t-child-1",
					number: 2,
					title: "DB Checker",
					role: "checker",
					parentId: "t-root",
					depth: 1,
					state: "answered",
					unread: 0,
					link: "/threads/t-child-1",
				},
			],
		};

		await act(async () => {
			root.render(
				<ChildFinishedCard
					event={
						{
							kind: "child_finished",
							runId: "t-root",
							childId: "t-child-1",
							role: "checker",
							outcome: "answered",
							excerpt: "Database connection pool is healthy.",
							ts: "2026-11-12T04:10:00Z",
						} as never
					}
				/>,
			);
		});

		const card = container.querySelector('[data-testid="tree-finished"]');
		expect(card?.getAttribute("data-outcome")).toBe("answered");
		// The status word has no element of its own: assert the card's whole text.
		expect(card?.textContent).toBe(
			`DB Checkerfinished ·Done${formatClock("2026-11-12T04:10:00Z")}Database connection pool is healthy.Read the answer`,
		);
	});
});

describe("ParentBar (#1101)", () => {
	it("returns null for a root node with no parentId", async () => {
		mockTreeData = {
			rootId: "t-root",
			allowance: null,
			nodes: [
				{
					id: "t-root",
					number: 1,
					title: "Root Investigation",
					role: null,
					parentId: null,
					depth: 0,
					state: "running",
					unread: 0,
					link: "/threads/t-root",
				},
			],
		};

		await act(async () => {
			root.render(<ParentBar threadId="t-root" />);
		});

		expect(container.querySelector('[data-testid="parent-bar"]')).toBeNull();
	});

	it("renders 'Started by <title>', 'level 1 of 2', and the parent's title as the link", async () => {
		mockTreeData = {
			rootId: "t-root",
			allowance: null,
			nodes: [
				{
					id: "t-root",
					number: 1,
					title: "Root Investigation",
					role: null,
					parentId: null,
					depth: 0,
					state: "running",
					unread: 0,
					link: "/threads/t-root",
				},
				{
					id: "t-child-1",
					number: 2,
					title: "Child Worker",
					role: "worker",
					parentId: "t-root",
					depth: 1,
					state: "running",
					unread: 0,
					link: "/threads/t-child-1",
				},
			],
			limits: {
				depth: 2,
				children: 5,
				perTree: 10,
				agentsStartThreads: "allow",
			},
		};

		await act(async () => {
			root.render(<ParentBar threadId="t-child-1" />);
		});

		const bar = container.querySelector('[data-testid="parent-bar"]');
		expect(bar).not.toBeNull();
		expect(bar?.textContent).toBe(
			"Started byRoot Investigation· worker· level 1 of 2",
		);

		const link = container.querySelector<HTMLAnchorElement>(
			'[data-testid="open-parent"]',
		);
		expect(link?.textContent).toBe("Root Investigation");
		expect(link?.getAttribute("href")).toBe("/threads/t-root");
	});
});
