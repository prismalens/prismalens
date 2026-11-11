// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadSession, ThreadTree } from "@prismalens/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	MachineAgentSection,
	sessionLine,
	ThreadTreeSection,
} from "./ThreadSections";

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
});

const clock = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

describe("sessionLine (#1024)", () => {
	it("returns Working, warm when live and cache is warm", () => {
		expect(
			sessionLine(true, { cache: "warm" } as unknown as ThreadSession),
		).toBe("Working, warm");
	});

	it("returns Idle when not live and cache is unknown", () => {
		expect(
			sessionLine(false, { cache: "unknown" } as unknown as ThreadSession),
		).toBe("Idle");
	});

	it("returns Limited until formatted resetsAt time when limit is set", () => {
		const resetsAt = "2026-11-10T14:30:00.000Z";
		const session = {
			limit: { resetsAt },
			cache: "unknown",
		} as unknown as ThreadSession;
		const expected = `Limited until ${clock.format(new Date(resetsAt))}`;
		expect(sessionLine(true, session)).toBe(expected);
	});
});

describe("MachineAgentSection (#1024)", () => {
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
			root.render(
				<MachineAgentSection
					context={context}
					agentLabel="Mock Agent"
					live={false}
				/>,
			);
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
			root.render(
				<MachineAgentSection
					context={context}
					agentLabel="Mock Agent"
					live={false}
				/>,
			);
		});

		const otherEl = container.querySelector('[data-testid="machine-other"]');
		expect(otherEl?.textContent).toBe(" · Another machine");
	});
});

describe("ThreadTreeSection (#1024)", () => {
	it("sets padding-left to 42px for a node at depth 5", async () => {
		const tree: ThreadTree = {
			rootId: "t1",
			allowance: null,
			nodes: [
				{
					id: "t2",
					number: 2,
					title: "Sub thread",
					state: "running",
					depth: 5,
					unread: 0,
					role: null,
					parentId: "t1",
					link: "/threads/t2",
				},
			],
		};

		await act(async () => {
			root.render(
				<ThreadTreeSection tree={tree} currentId="t1" isHost={true} />,
			);
		});

		const nodeEl = container.querySelector<HTMLLIElement>(
			'[data-testid="thread-tree-node"]',
		);
		expect(nodeEl?.style.paddingLeft).toBe("42px");
	});

	it("renders 2 unread for screen readers when unread count is 2", async () => {
		const tree: ThreadTree = {
			rootId: "t1",
			allowance: null,
			nodes: [
				{
					id: "t2",
					number: 2,
					title: "Sub thread",
					state: "running",
					depth: 1,
					unread: 2,
					role: null,
					parentId: "t1",
					link: "/threads/t2",
				},
			],
		};

		await act(async () => {
			root.render(
				<ThreadTreeSection tree={tree} currentId="t1" isHost={true} />,
			);
		});

		const unreadEl = container.querySelector(
			'[data-testid="thread-tree-unread"] .sr-only',
		);
		expect(unreadEl?.textContent).toBe("2 unread");
	});

	it("shows Agents may start threads here and Revoke button only when isHost is true and click calls onRevoke", async () => {
		const onRevoke = vi.fn();
		const tree: ThreadTree = {
			rootId: "t1",
			allowance: { grantedAt: "2026-11-10T12:00:00.000Z" },
			nodes: [],
		};

		await act(async () => {
			root.render(
				<ThreadTreeSection
					tree={tree}
					currentId="t1"
					isHost={true}
					onRevoke={onRevoke}
				/>,
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
				<ThreadTreeSection
					tree={tree}
					currentId="t1"
					isHost={false}
					onRevoke={onRevoke}
				/>,
			);
		});

		const noHostAllowance = container.querySelector(
			'[data-testid="thread-tree-allowance"]',
		);
		expect(noHostAllowance?.textContent).toBe("Agents may start threads here");
		expect(noHostAllowance?.querySelector("button")).toBeNull();
	});
});
