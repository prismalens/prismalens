// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The `threads.flat` lens's check: threads are flat siblings (#1101 decision, 2026-11-13).
 * One starter with many agent-started threads renders one row and one Home card per thread,
 * with no group, chevron or count around them. `ui:check:static` runs this file.
 */
import type { ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeNeeds } from "@/components/home/HomeHandover";
import { ThreadTreeView } from "@/components/shell/ThreadTree";
import { threadList } from "@/lib/thread-list";

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
	useResumeInvestigation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api/hooks/use-session-orpc", () => ({
	useRetryNow: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-operator", () => ({
	useOperator: () => ({ via: "token", managesPairing: true }),
}));

const NOW = Date.parse("2026-11-12T12:00:00.000Z");

const thread = (id: string, status: string, agentStarted: boolean) =>
	({
		id,
		title: `Thread ${id}`,
		status: "completed",
		kind: "chat",
		origin: "local",
		schemaVersion: 1,
		createdAt: "2026-11-12T10:00:00.000Z",
		updatedAt: "2026-11-12T10:00:00.000Z",
		lastActivityAt: `2026-11-12T10:${id.padStart(2, "0")}:00.000Z`,
		lastVisitedAt: "2026-11-12T10:00:00.000Z",
		settledAt: null,
		unseen: false,
		latestText: null,
		projectName: null,
		titleSetBy: null,
		serviceName: null,
		section: "active",
		state: { status },
		...(agentStarted
			? {
					startedBy: {
						id: "0",
						title: "Starter",
						link: "/threads/0",
						via: "agent",
					},
				}
			: {}),
	}) as unknown as ThreadRow;

// One starter, eight agent-started threads waiting on you and six that need nothing.
const STATUSES = ["approval", "question", "blocked", "limited"] as const;
const threads = [
	thread("0", "working", false),
	...Array.from({ length: 8 }, (_, i) =>
		thread(String(i + 1), STATUSES[i % 4] ?? "approval", true),
	),
	...Array.from({ length: 6 }, (_, i) => thread(String(i + 9), "done", true)),
];
const units: ThreadUnit[] = threads.map((t) => ({
	section: "active",
	incident: null,
	threads: [t],
}));
const model = threadList(units);

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

const draw = (el: ReturnType<typeof createElement>) =>
	act(async () => root.render(el));

/** Anything between a row and its section that folds, groups or counts rows. */
const wrappers = (row: Element, stop: Element): string[] => {
	const found: string[] = [];
	for (let el = row.parentElement; el && el !== stop; el = el.parentElement) {
		if (el.hasAttribute("aria-expanded")) found.push("aria-expanded");
		const role = el.getAttribute("role");
		if (role === "group" || role === "tree" || role === "treeitem")
			found.push(`role=${role}`);
		if (
			Array.from(el.children).some(
				(c) => c.tagName === "BUTTON" && c.hasAttribute("aria-expanded"),
			)
		)
			found.push("toggle");
	}
	return found;
};

describe("threads never nest (lens threads.flat, #1101 decision 2026-11-13)", () => {
	it("draws each of the 15 threads as its own sidebar row, none inside another row or a fold", async () => {
		await draw(
			createElement(ThreadTreeView, {
				model,
				asks: new Map(),
				now: NOW,
				currentId: null,
			}),
		);
		const rows = Array.from(
			container.querySelectorAll('[data-testid="thread-row"]'),
		);
		expect(rows.map((r) => r.getAttribute("data-id")).sort()).toEqual(
			threads.map((t) => t.id).sort(),
		);
		expect(
			rows.filter((r) => r.querySelector('[data-testid="thread-row"]')),
		).toEqual([]);
		const folded = rows.flatMap((r) => {
			const section = r.closest('[data-testid^="thread-section-"]');
			if (!section) return [`${r.getAttribute("data-id")}: no section`];
			return wrappers(r, section).map(
				(w) => `${r.getAttribute("data-id")}: ${w}`,
			);
		});
		expect(folded).toEqual([]);
		expect(container.textContent).not.toMatch(/threads it started/);
	});

	it("keeps the 8 waiting agent-started rows in Needs you, and sinks the 6 that need nothing below the person's own thread", async () => {
		await draw(
			createElement(ThreadTreeView, {
				model,
				asks: new Map(),
				now: NOW,
				currentId: null,
			}),
		);
		const ids = (section: string) =>
			Array.from(
				container.querySelectorAll(
					`[data-testid="thread-section-${section}"] [data-testid="thread-row"]`,
				),
			).map((r) => r.getAttribute("data-id"));
		expect(ids("needs").sort()).toEqual(
			["1", "2", "3", "4", "5", "6", "7", "8"].sort(),
		);
		expect(ids("threads")).toEqual(["0", "14", "13", "12", "11", "10", "9"]);
	});

	it("gives Home one Needs-you card per waiting thread, with no card standing for a starter's group", async () => {
		await draw(
			createElement(HomeNeeds, {
				needs: model.needs,
				count: model.needsCount,
				asks: new Map(),
				now: NOW,
			}),
		);
		const show = container.querySelector(
			'[data-testid="home-needs-more"]',
		) as HTMLButtonElement | null;
		expect(show?.textContent).toBe("Show 2 more");
		await act(async () => show?.click());
		expect(
			container.querySelectorAll('[data-testid="home-needs-card"]').length,
		).toBe(8);
		expect(container.textContent).not.toMatch(/threads it started/);
	});
});
