// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadLinks, ThreadSession } from "@prismalens/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheWord, SessionSection, StartedSection } from "./ThreadSections";

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

// The roster reads each child's status from the server; these rows fall back to their own.
vi.mock("@/components/shared/Hint", () => ({
	Hint: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/api/hooks/use-threads-orpc", () => ({
	useThreadStatuses: () => ({ data: undefined }),
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
});

// 7ce8c0ffa: the status is the header's; the section keeps only the prompt cache.
describe("cacheWord", () => {
	it("returns Warm for a warm cache and null for an unknown one", () => {
		expect(cacheWord({ cache: "warm" } as unknown as ThreadSession)).toBe(
			"Warm",
		);
		expect(
			cacheWord({ cache: "unknown" } as unknown as ThreadSession),
		).toBeNull();
	});
});

describe("SessionSection (#1024)", () => {
	it("shows build-box · Linux and no machine-other when isHost is true", async () => {
		const context = {
			machine: {
				hostName: "build-box",
				os: "linux" as const,
				isHost: true,
			},
			agent: {
				harness: "mock-harness",
				model: "mock-model",
				effort: null,
			},
		};

		await act(async () => {
			root.render(<SessionSection context={context} />);
		});

		const machineEl = container.querySelector('[data-testid="machine"]');
		expect(machineEl?.textContent).toContain("build-box · Linux");
		expect(container.querySelector('[data-testid="machine-other"]')).toBeNull();
	});

	it("shows Another machine when isHost is false", async () => {
		const context = {
			machine: {
				hostName: "build-box",
				os: "linux" as const,
				isHost: false,
			},
			agent: {
				harness: "mock-harness",
				model: "mock-model",
				effort: null,
			},
		};

		await act(async () => {
			root.render(<SessionSection context={context} />);
		});

		const otherEl = container.querySelector('[data-testid="machine-other"]');
		expect(otherEl?.textContent).toBe(" · Another machine");
	});
});

const LINKS = (over: Partial<ThreadLinks> = {}): ThreadLinks => ({
	startedBy: null,
	started: [],
	allowance: null,
	chainId: "t1",
	limits: {
		agentsStartThreads: "ask",
		perStarter: 4,
		total: 10,
		turnsPerDay: 200,
		pairPerDay: 20,
	},
	...over,
});

// fd1fac924 replaced the indented tree with who started it and a flat started list.
describe("StartedSection (#1101 cat 10)", () => {
	it("links the starter with its started-by mark, lists the started threads flat, and counts the running ones against the per-starter cap", async () => {
		const links = LINKS({
			startedBy: {
				id: "s1",
				title: "Checkout 502s",
				link: "/threads/s1",
				state: "running",
				unread: 0,
				via: "agent",
			},
			started: [
				{
					id: "a",
					title: "Check the pool",
					link: "/threads/a",
					state: "running",
					unread: 2,
				},
				{
					id: "b",
					title: "Bisect",
					link: "/threads/b",
					state: "answered",
					unread: 0,
				},
			],
		});
		await act(async () => {
			root.render(<StartedSection links={links} isHost={true} />);
		});
		const by = container.querySelector(
			'[data-testid="thread-links-started-by"]',
		);
		expect(by?.textContent).toContain("Checkout 502s");
		expect(
			by
				?.querySelector('[data-testid="mark-started-by"]')
				?.getAttribute("aria-label"),
		).toBe("Started by Checkout 502s");
		expect(
			Array.from(container.querySelectorAll('[data-testid="started-row"]')).map(
				(r) => r.getAttribute("data-state"),
			),
		).toEqual(["running"]);
		expect(
			container.querySelector('[data-testid="thread-tree-node"]'),
		).toBeNull();
		expect(
			container.querySelector('[data-testid="thread-tree-limits"]')
				?.textContent,
		).toContain("1 of 4 running");
	});

	it("shows Agents may start threads here and Revoke button only when isHost is true and click calls onRevoke", async () => {
		const onRevoke = vi.fn();
		const links = LINKS({
			allowance: { grantedAt: "2026-11-10T12:00:00.000Z" },
		});
		await act(async () => {
			root.render(
				<StartedSection links={links} isHost={true} onRevoke={onRevoke} />,
			);
		});
		const allowanceEl = container.querySelector(
			'[data-testid="thread-tree-allowance"]',
		);
		expect(allowanceEl?.textContent).toContain("Agents may start threads here");
		const revokeBtn = allowanceEl?.querySelector("button");
		expect(revokeBtn?.textContent).toBe("Revoke");
		await act(async () => {
			revokeBtn?.click();
		});
		expect(onRevoke).toHaveBeenCalledTimes(1);
		await act(async () => {
			root.render(
				<StartedSection links={links} isHost={false} onRevoke={onRevoke} />,
			);
		});
		const noHostAllowance = container.querySelector(
			'[data-testid="thread-tree-allowance"]',
		);
		expect(noHostAllowance?.textContent).toBe("Agents may start threads here");
		expect(noHostAllowance?.querySelector("button")).toBeNull();
	});
});
