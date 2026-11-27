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
const lead = (id: string) =>
	wrapOf(id).querySelector('[data-testid="row-meta"] > span');
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

describe("a row has fixed lines: place and status corner, title, meta (#1020)", () => {
	it("draws place and corner, then title, then meta on every row, the corner holding the status icon and the time", async () => {
		await render([
			thread({
				id: "done",
				title: "Done one",
				serviceName: "checkout-api",
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
		const lines = (id: string) =>
			Array.from(
				wrapOf(id).querySelector('[data-testid="thread-row"]')?.children ?? [],
			).map((c) => c.getAttribute("data-testid"));
		expect(lines("done")).toEqual(["row-context", "row-title", "row-meta"]);
		expect(lines("other")).toEqual(["row-context", "row-title", "row-meta"]);
		const corner = (id: string) =>
			Array.from(
				wrapOf(id).querySelector('[data-testid="row-corner"]')?.children ?? [],
			).map((c) => c.getAttribute("data-fact"));
		expect(corner("done")).toEqual(["status", "activity"]);
		expect(
			wrapOf("done")
				.querySelector('[role="img"][data-fact="status"]')
				?.getAttribute("aria-label"),
		).toBe("Done");
		expect(
			wrapOf("done")
				.querySelector('[data-testid="row-place"]')
				?.getAttribute("aria-label"),
		).toBe("Service checkout-api");
		expect(
			wrapOf("other").querySelector('[data-testid="row-place"]'),
		).toBeNull();
		// A run of 1h 11m reads its largest unit in the time slot.
		expect(
			wrapOf("other").querySelector('[data-testid="row-age"]')?.textContent,
		).toBe("1h");
	});

	it("ends the meta line with the session's agent on every row, the default agent included, drawn in the same render as the title so no row grows when badges arrive", async () => {
		await render([
			thread({
				id: "default",
				harness: "claude-code",
				pr: { number: 9, tone: "open", count: 1 },
			} as Partial<ThreadRow>),
			thread({ id: "codex", harness: "codex" } as Partial<ThreadRow>),
		]);
		const badges = (id: string) =>
			Array.from(
				wrapOf(id).querySelectorAll('[data-testid^="row-badge-"]'),
			).map((b) => b.getAttribute("aria-label"));
		// No wait: a badge that drew in a later render would grow its row under the reader (#1247 D25).
		expect(badges("default")).toEqual(["Pull request #9, open", "Claude Code"]);
		expect(badges("codex")).toEqual(["Codex"]);
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

	it("keeps the meta line with an empty lead where the icon says it all: a stopped run, a failure with no words", async () => {
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
		expect(testIds(lead("stopped"))).toEqual([]);
		expect(testIds(lead("failed"))).toEqual([]);
	});
});

describe("the meta line leads with the starter, then the reason and the branch (#1020)", () => {
	const pr = { number: 9, tone: "open", count: 1 };
	const git = { state: "conflict", op: null, files: [], count: 0 };
	it("puts a reason's mark before the branch, a reason in words in the branch's place, and the PR among the badges", async () => {
		await render([
			thread({
				id: "reason",
				pr,
				branch: "feat/x",
				state: {
					status: "waiting",
					waitingOn: { kind: "pr", number: 9, until: "review" },
				},
			} as Partial<ThreadRow>),
			thread({
				id: "words",
				branch: "feat/x",
				status: "failed",
				error: "The agent stopped",
				state: { status: "failed" },
			} as Partial<ThreadRow>),
			thread({ id: "pr", pr, git, branch: "feat/x" } as Partial<ThreadRow>),
		]);
		expect(testIds(lead("reason"))).toEqual(["row-detail", "row-branch"]);
		expect(detail("reason")).toMatchObject({ mark: "review", text: "#9" });
		expect(testIds(lead("words"))).toEqual(["row-detail"]);
		expect(testIds(lead("pr"))).toEqual(["row-branch"]);
		expect(
			wrapOf("pr")
				.querySelector('[data-testid="row-branch"]')
				?.getAttribute("aria-label"),
		).toBe("Branch feat/x, in a conflict");
		expect(
			wrapOf("pr").querySelector('[data-testid="row-badge-pr"]')?.textContent,
		).toBe("#9");
	});

	it("leads with the starter, before a branch and on a row with nothing else to say, never on the first line", async () => {
		const startedBy = {
			id: "root",
			title: "Starter",
			link: "/threads/root",
			via: "agent",
		};
		await render([
			thread({ id: "started", startedBy } as Partial<ThreadRow>),
			thread({
				id: "branched",
				startedBy,
				branch: "feat/x",
			} as Partial<ThreadRow>),
		]);
		expect(testIds(lead("branched"))).toEqual([
			"mark-started-by",
			"row-branch",
		]);
		expect(testIds(lead("started"))).toEqual(["mark-started-by"]);
		expect(
			wrapOf("started").querySelector(
				'[data-testid="row-context"] [data-testid="mark-started-by"]',
			),
		).toBeNull();
	});
});
