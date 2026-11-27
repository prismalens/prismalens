// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const render = (threads: ThreadRow[]) =>
	act(async () =>
		root.render(
			createElement(
				DefaultAgent.Provider,
				{ value: { id: "claude-code" } },
				createElement(ThreadTreeView, {
					model: threadList(threads.map(one)),
					asks: new Map(),
					now: NOW,
					currentId: null,
				}),
			),
		),
	);

const wrapOf = (id: string) => {
	const wrap = container
		.querySelector(`[data-testid="thread-row"][data-id="${id}"]`)
		?.closest('[data-testid="thread-row-wrap"]');
	if (!wrap) throw new Error(`no row ${id}`);
	return wrap;
};
const firstLine = (id: string) =>
	wrapOf(id).querySelector('[data-testid="thread-row"] > span') as HTMLElement;
const lineTwo = (id: string) =>
	wrapOf(id).querySelector('[data-testid="row-meta"]');
const testIds = (el: Element | null) =>
	Array.from(el?.querySelectorAll("[data-testid]") ?? []).map((e) =>
		e.getAttribute("data-testid"),
	);
const detail = (id: string) => {
	const d = wrapOf(id).querySelector('[data-testid="row-detail"]');
	return {
		mark: d?.closest("[data-reason]")?.getAttribute("data-reason") ?? null,
		name: d?.getAttribute("aria-label") ?? null,
		text: d?.textContent ?? null,
	};
};

describe("a row is four columns: status icon, title, time, agent (#1101 cat 2)", () => {
	it("says its status by the icon alone, and keeps the time and agent cells on every row", async () => {
		await render([
			thread({
				id: "done",
				title: "Done one",
				harness: "claude-code",
			} as Partial<ThreadRow>),
			thread({
				id: "other",
				title: "Other agent",
				harness: "codex",
				status: "running",
				startedAt: "2026-11-12T10:49:00.000Z",
				state: { status: "working" },
			} as Partial<ThreadRow>),
		]);
		expect(
			container.querySelectorAll('[data-testid="row-status"]'),
		).toHaveLength(0);
		expect(
			wrapOf("done")
				.querySelector('[role="img"][data-fact="status"]')
				?.getAttribute("aria-label"),
		).toBe("Done");
		const cells = (id: string) =>
			Array.from(firstLine(id).children).flatMap((c) =>
				c.getAttribute("data-testid") === "row-slot"
					? Array.from(c.children).map((x) => x.getAttribute("data-testid"))
					: [c.getAttribute("data-fact") ?? c.getAttribute("data-testid")],
			);
		expect(cells("done")).toEqual(["status", "title", "row-age", "row-agent"]);
		expect(cells("other")).toEqual(["status", "title", "row-age", "row-agent"]);
		// Your default agent leaves its cell empty; another agent fills it.
		expect(
			wrapOf("done").querySelector('[data-testid="row-agent"]')?.children,
		).toHaveLength(0);
		expect(
			wrapOf("other")
				.querySelector('[data-testid="row-agent"] [data-testid="mark-agent"]')
				?.getAttribute("aria-label"),
		).toBe("Codex");
		// A run of 1h 11m reads its largest unit in the time column.
		expect(
			wrapOf("other").querySelector('[data-testid="row-age"]')?.textContent,
		).toBe("1h");
	});
});

describe("a row's reason is an icon and a token, its sentence in its name (#1101 cat 2)", () => {
	it("draws a PR watch, a schedule, a wake and a quiet run as their marks", async () => {
		await render([
			thread({
				id: "watch",
				state: {
					status: "waiting",
					waitingOn: { kind: "pr", number: 412, until: "checks_done" },
				},
			}),
			thread({
				id: "merge",
				state: {
					status: "waiting",
					waitingOn: { kind: "pr", number: 7, until: "merged" },
				},
			}),
			thread({
				id: "cron",
				state: {
					status: "waiting",
					waitingOn: {
						kind: "cron",
						schedule: "0 9 * * *",
						nextAt: "2026-11-12T14:00:00.000Z",
					},
				},
			}),
			thread({
				id: "wake",
				state: {
					status: "waiting",
					waitingOn: { kind: "wake", at: "2026-11-12T12:30:00.000Z" },
				},
			}),
			thread({
				id: "quiet",
				status: "running",
				state: { status: "working", quietSince: "2026-11-12T11:48:00.000Z" },
			} as Partial<ThreadRow>),
		]);
		expect(detail("watch")).toEqual({
			mark: "checks",
			name: "Watching PR #412 checks",
			text: "#412",
		});
		expect(detail("merge")).toEqual({
			mark: "merged",
			name: "Watching PR #7 until merged",
			text: "#7",
		});
		expect(detail("cron")).toMatchObject({ mark: "repeat", text: "in 2h" });
		expect(detail("cron").name).toMatch(/, next in 2h$/);
		expect(detail("wake")).toEqual({
			mark: "wake",
			name: "Wakes in 30m",
			text: "in 30m",
		});
		expect(detail("quiet")).toEqual({
			mark: "quiet",
			name: "Working, quiet for 12 min",
			text: "12m",
		});
	});

	it("draws failing checks on a seen failed row as the failing mark and its PR number", async () => {
		await render([
			thread({
				id: "checks",
				status: "failed",
				state: { status: "failed", checks: { number: 418 } },
			} as Partial<ThreadRow>),
		]);
		expect(detail("checks")).toEqual({
			mark: "failing",
			name: "Checks failing on PR #418",
			text: "#418",
		});
	});

	it("draws no line 2 where the icon says it all: a stopped run, a failure with no words", async () => {
		await render([
			thread({
				id: "stopped",
				status: "cancelled",
				state: { status: "done", stopped: true },
			} as Partial<ThreadRow>),
			thread({
				id: "failed",
				status: "failed",
				state: { status: "failed" },
			} as Partial<ThreadRow>),
		]);
		expect(lineTwo("stopped")).toBeNull();
		expect(lineTwo("failed")).toBeNull();
	});
});

describe("line 2 holds one fact (#1101 density)", () => {
	const pr = { number: 9, tone: "open", count: 1 };
	const git = { state: "conflict", branch: "feat/x" };
	it("shows a reason before the PR, the PR before the agent's line, and never the branch or git state", async () => {
		await render([
			thread({
				id: "reason",
				pr,
				git,
				branch: "feat/x",
				latestText: "Pushed the fix.",
				state: {
					status: "waiting",
					waitingOn: { kind: "pr", number: 9, until: "review" },
				},
			} as Partial<ThreadRow>),
			thread({
				id: "pr",
				pr,
				git,
				branch: "feat/x",
				latestText: "Pushed the fix.",
			} as Partial<ThreadRow>),
			thread({
				id: "line",
				branch: "feat/x",
				latestText: "Pushed the fix.",
			} as Partial<ThreadRow>),
		]);
		expect(testIds(lineTwo("reason"))).toEqual(["row-detail"]);
		expect(detail("reason")).toMatchObject({ mark: "review", text: "#9" });
		expect(testIds(lineTwo("pr"))).toEqual(["mark-pr"]);
		expect(testIds(lineTwo("line"))).toEqual(["row-detail"]);
		expect(detail("line").text).toBe("Pushed the fix.");
		expect(
			container.querySelectorAll(
				'[data-testid="mark-branch"], [data-testid="mark-git-state"]',
			),
		).toHaveLength(0);
	});

	it("leads line 2 with the starter, before another fact and on a row with nothing else to say", async () => {
		const startedBy = {
			id: "root",
			title: "Starter",
			link: "/threads/root",
			via: "agent",
		};
		await render([
			thread({ id: "started", startedBy } as Partial<ThreadRow>),
			thread({
				id: "said",
				startedBy,
				latestText: "Pushed the fix.",
			} as Partial<ThreadRow>),
		]);
		expect(testIds(lineTwo("said"))).toEqual(["mark-started-by", "row-detail"]);
		expect(testIds(lineTwo("started"))).toEqual(["mark-started-by"]);
		expect(
			firstLine("started").querySelector('[data-testid="mark-started-by"]'),
		).toBeNull();
	});
});
