// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PendingAsk, ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { threadList } from "@/lib/thread-list";
import type { RowAskEntry } from "./RowAsk";
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
// The ask card's chunk fails to load, as on a dropped link.
vi.mock("./RowAskCard", () => {
	throw new Error("chunk failed");
});
vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => ({ via: "token", managesPairing: true }),
}));

const NOW = Date.parse("2026-11-12T12:00:00.000Z");

const row = {
	id: "a",
	title: "Run the migration",
	status: "running",
	kind: "chat",
	origin: "local",
	schemaVersion: 1,
	createdAt: "2026-11-12T10:00:00.000Z",
	updatedAt: "2026-11-12T10:00:00.000Z",
	lastActivityAt: "2026-11-12T11:58:00.000Z",
	lastVisitedAt: "2026-11-12T11:58:00.000Z",
	settledAt: null,
	unseen: false,
	latestText: null,
	projectName: null,
	titleSetBy: null,
	serviceName: null,
	section: "active",
	state: { status: "approval" },
} as unknown as ThreadRow;
const ask = {
	askId: "00000000-0000-4000-8000-000000000001",
	threadId: "a",
	kind: "permission",
	requiresHost: false,
	source: { kind: "agent" },
	title: "Run the migration",
	openedAt: "2026-11-12T11:58:00.000Z",
} as PendingAsk;
const units: ThreadUnit[] = [
	{ section: "active", incident: null, threads: [row] },
];

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

describe("an ask card whose code fails to load (#1020)", () => {
	it("says so and offers Retry and Open to answer, so the ask stays answerable", async () => {
		await act(async () =>
			root.render(
				createElement(ThreadTreeView, {
					model: threadList(units),
					asks: new Map([["a", [{ ask, ended: false, accessLevel: null }]]]),
					now: NOW,
					currentId: null,
				}),
			),
		);
		await act(async () => {
			(
				container.querySelector(
					'[data-testid="thread-row"][data-id="a"]',
				) as HTMLElement | null
			)?.click();
		});
		const problem = () =>
			document.body.querySelector(
				'[data-testid="row-ask-card"] [data-testid="state-problem"]',
			);
		await vi.waitFor(() => expect(problem()).not.toBeNull(), {
			timeout: 3000,
		});
		expect(problem()?.textContent).toBe(
			"The ask did not load.RetryOpen to answer",
		);
	});
});
