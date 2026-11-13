// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadLinks } from "@prismalens/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadMessageCard, ThreadStartedCard } from "./ThreadCards";

let mockLinks: ThreadLinks | null = null;

vi.mock("@/lib/api/hooks/use-thread-tree-orpc", () => ({
	useThreadLinks: () => ({ data: mockLinks }),
}));
vi.mock("@/lib/api/hooks/use-investigations-orpc", () => ({
	useCancelInvestigation: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/components/kit/Surface", () => ({
	Surface: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
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
	mockLinks = null;
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const WORKER = "00000000-0000-4000-8000-000000000001";
const ROOT = "00000000-0000-4000-8000-0000000000aa";

// fd1fac924 replaced the live child rows with a "Started thread" row and plain-text message cards.
describe("ThreadStartedCard (#1101 cat 10)", () => {
	it("reads Started thread, links the started thread by its title, and shows its status mark", async () => {
		mockLinks = {
			startedBy: null,
			started: [
				{
					id: WORKER,
					title: "Check the pool",
					link: `/threads/${WORKER}`,
					state: "running",
					unread: 0,
				},
			],
			allowance: null,
			chainId: ROOT,
			limits: {
				agentsStartThreads: "ask",
				perStarter: 4,
				total: 10,
				turnsPerDay: 200,
				pairPerDay: 20,
			},
		};
		await act(async () => {
			root.render(
				<ThreadStartedCard
					event={
						{
							kind: "thread_started",
							runId: ROOT,
							childId: WORKER,
							title: "Old title",
							link: `/threads/${WORKER}`,
						} as never
					}
				/>,
			);
		});
		const row = container.querySelector('[data-testid="tree-started"]');
		expect(row?.textContent).toContain("Started thread");
		expect(row?.querySelector("a")?.getAttribute("href")).toBe(
			`/threads/${WORKER}`,
		);
		expect(row?.querySelector("a")?.textContent).toBe("Check the pool");
		expect(
			container
				.querySelector('[data-testid="child-state"] [data-status]')
				?.getAttribute("data-status"),
		).toBe("working");
	});
});

describe("ThreadMessageCard (#1101 cat 10)", () => {
	it("reads Messaged <title> when sent and From <title> when received, links the peer, and clamps long text", async () => {
		const longText = "First line of long message\n" + "x".repeat(300);
		await act(async () => {
			root.render(
				<ThreadMessageCard
					event={
						{
							kind: "thread_message",
							runId: ROOT,
							direction: "sent",
							peerId: WORKER,
							peerLink: `/threads/${WORKER}`,
							peerTitle: "Check the pool",
							mode: "queue",
							text: longText,
							ts: "2026-11-12T04:00:00Z",
						} as never
					}
				/>,
			);
		});
		const sentCard = container.querySelector('[data-testid="tree-message"]');
		expect(sentCard?.getAttribute("data-direction")).toBe("sent");
		expect(sentCard?.textContent).toContain("Messaged Check the pool");
		expect(sentCard?.querySelector("a")?.getAttribute("href")).toBe(
			`/threads/${WORKER}`,
		);
		const expandBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="tree-message-expand"]',
		);
		expect(expandBtn?.textContent).toBe("Show all");
		await act(async () => {
			expandBtn?.click();
		});
		expect(expandBtn?.textContent).toBe("Show less");

		await act(async () => {
			root.render(
				<ThreadMessageCard
					event={
						{
							kind: "thread_message",
							runId: WORKER,
							direction: "received",
							peerId: ROOT,
							peerLink: `/threads/${ROOT}`,
							peerTitle: "Checkout 502s",
							mode: "steer",
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
		expect(receivedCard?.textContent).toContain("From Checkout 502s · steered");
		expect(
			container.querySelector('[data-testid="tree-message-expand"]'),
		).toBeNull();
		expect(container.querySelector('[data-testid="message-held"]')).toBeNull();
	});

	it("marks a message held past the pair cap, and names an old event's peer by its role", async () => {
		await act(async () => {
			root.render(
				<ThreadMessageCard
					event={
						{
							kind: "thread_message",
							runId: ROOT,
							direction: "received",
							peerId: WORKER,
							peerLink: `/threads/${WORKER}`,
							peerRole: "db",
							mode: "queue",
							held: true,
							text: "one more",
							ts: "2026-11-12T04:05:00Z",
						} as never
					}
				/>,
			);
		});
		const card = container.querySelector('[data-testid="tree-message"]');
		expect(card?.getAttribute("data-held")).toBe("true");
		expect(card?.textContent).toContain("From db");
		expect(
			container
				.querySelector('[data-testid="message-held"]')
				?.getAttribute("aria-label"),
		).toBe(
			"Held: the message cap between these threads was reached, so it woke nothing",
		);
	});
});
