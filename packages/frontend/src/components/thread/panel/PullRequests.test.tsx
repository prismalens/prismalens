// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	PrCheckLog,
	PrCheckRun,
	PrChecks,
	PrTone,
} from "@prismalens/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prToneClass } from "@/lib/pr-tone";
import {
	checksCount,
	checksLine,
	PR_TONE_WORD,
	type PrWatch,
	PullRequestRow,
	type PullRequestView,
	sortedRuns,
	watchLine,
} from "./PullRequests";
import { checkFixMessage } from "./pr-fix";

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

function renderWithClient(ui: React.ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

const basePr: PullRequestView = {
	id: "pr-1",
	number: 42,
	host: "github",
	repo: "repo",
	title: "feat: new thing",
	url: "https://github.com/o/r/pull/42",
	state: "open",
	tone: "open",
	checks: { state: "none", total: 0, failed: 0, pending: 0 },
	review: "none",
	conflicts: false,
	source: "branch",
	fetchedAt: null,
};

describe("checksCount (#1024)", () => {
	it.each([
		[
			{ state: "failing" as const, total: 9, failed: 2, pending: 1 },
			"6/9 checks",
		],
		[
			{ state: "passing" as const, total: 4, failed: 0, pending: 0 },
			"4/4 checks",
		],
		[{ state: "none" as const, total: 0, failed: 0, pending: 0 }, null],
		[{ state: "unknown" as const, total: 5, failed: 1, pending: 0 }, null],
	] as const)("checksCount of %j returns %s", (checks, expected) => {
		expect(checksCount(checks as PrChecks)).toBe(expected);
	});
});

describe("checksLine (#1024)", () => {
	it.each([
		[
			{ state: "failing" as const, total: 9, failed: 2, pending: 1 },
			"2 failing · 1 running of 9",
		],
		[
			{ state: "passing" as const, total: 4, failed: 0, pending: 0 },
			"4 passing",
		],
		[{ state: "none" as const, total: 0, failed: 0, pending: 0 }, null],
	] as const)("checksLine of %j returns %s", (checks, expected) => {
		expect(checksLine(checks as PrChecks)).toBe(expected);
	});
});

describe("watchLine (#1024)", () => {
	it.each([
		[{ state: "watching" as const }, "Watching checks and reviews"],
		[{ state: "waiting" as const }, "Update waiting for the agent"],
		[{ state: "disconnected" as const }, "Host unreachable, retrying"],
		[
			{ state: "expired" as const, reason: "thread idle 7 days" },
			"Stopped watching: thread idle 7 days",
		],
		[{ state: "stopped" as const, reason: "merged" }, "Stopped: merged"],
	])("watchLine for %j returns %s", (watch, expected) => {
		expect(watchLine(watch as PrWatch)).toBe(expected);
	});
});

describe("sortedRuns (#1024)", () => {
	it("orders runs by failing, pending, neutral, passing and preserves host order within each state", () => {
		const runs: PrCheckRun[] = [
			{ name: "passing-1", state: "passing" },
			{ name: "failing-1", state: "failing" },
			{ name: "neutral-1", state: "neutral" },
			{ name: "pending-1", state: "pending" },
			{ name: "failing-2", state: "failing" },
			{ name: "passing-2", state: "passing" },
			{ name: "neutral-2", state: "neutral" },
			{ name: "pending-2", state: "pending" },
		];
		const sorted = sortedRuns(runs);
		expect(sorted.map((r) => r.name)).toEqual([
			"failing-1",
			"failing-2",
			"pending-1",
			"pending-2",
			"neutral-1",
			"neutral-2",
			"passing-1",
			"passing-2",
		]);
	});
});

describe("PullRequestRow (#1024)", () => {
	it.each([
		"ready",
		"open",
		"draft",
		"attention",
		"failing",
		"merged",
		"closed",
		"unknown",
	] as const)(
		"shows tone word and mark class for tone %s",
		async (tone: PrTone) => {
			const pr: PullRequestView = { ...basePr, tone };
			await act(async () => {
				root.render(renderWithClient(<PullRequestRow pr={pr} />));
			});
			const wordEl = container.querySelector('[data-testid="pr-tone-word"]');
			expect(wordEl?.textContent).toBe(PR_TONE_WORD[tone]);
			const icon = container.querySelector("svg");
			const expectedClass = prToneClass(tone);
			expect(icon?.getAttribute("class")).toContain(expectedClass);
		},
	);

	it("shows Merge conflict when conflicts is true", async () => {
		const pr: PullRequestView = { ...basePr, conflicts: true };
		await act(async () => {
			root.render(renderWithClient(<PullRequestRow pr={pr} />));
		});
		const el = container.querySelector('[data-testid="pr-conflicts"]');
		expect(el?.textContent).toBe("Merge conflict");
	});

	it("shows Approved when review is approved", async () => {
		const pr: PullRequestView = { ...basePr, review: "approved" };
		await act(async () => {
			root.render(renderWithClient(<PullRequestRow pr={pr} />));
		});
		const el = container.querySelector('[data-testid="pr-review"]');
		expect(el?.textContent).toBe("Approved");
	});

	it("expands check runs on click from aria-expanded false to true and shows 3 rows", async () => {
		const pr: PullRequestView = {
			...basePr,
			checks: { state: "failing", total: 3, failed: 1, pending: 1 },
			checkRuns: [
				{ name: "lint", state: "passing" },
				{ name: "test", state: "failing" },
				{ name: "build", state: "pending" },
			],
		};
		await act(async () => {
			root.render(renderWithClient(<PullRequestRow pr={pr} />));
		});
		const btn = container.querySelector<HTMLButtonElement>(
			'[data-testid="pr-checks"]',
		);
		expect(btn?.getAttribute("aria-expanded")).toBe("false");
		expect(
			container.querySelectorAll('[data-testid="pr-check-run"]'),
		).toHaveLength(0);

		await act(async () => {
			btn?.click();
		});

		expect(btn?.getAttribute("aria-expanded")).toBe("true");
		const rows = container.querySelectorAll('[data-testid="pr-check-run"]');
		expect(rows).toHaveLength(3);
	});

	it("with onWatch button reads Stop watching for watching and calls onWatch(pr, false)", async () => {
		const onWatch = vi.fn();
		const pr: PullRequestView = {
			...basePr,
			watch: { state: "watching" },
		};
		await act(async () => {
			root.render(
				renderWithClient(<PullRequestRow pr={pr} onWatch={onWatch} />),
			);
		});
		const watchEl = container.querySelector('[data-testid="pr-watch"]');
		const btn = watchEl?.querySelector("button");
		expect(btn?.textContent).toBe("Stop watching");

		await act(async () => {
			btn?.click();
		});
		expect(onWatch).toHaveBeenCalledWith(pr, false);
	});

	it("with onWatch button reads Watch for stopped and calls onWatch(pr, true)", async () => {
		const onWatch = vi.fn();
		const pr: PullRequestView = {
			...basePr,
			watch: { state: "stopped", reason: "merged" },
		};
		await act(async () => {
			root.render(
				renderWithClient(<PullRequestRow pr={pr} onWatch={onWatch} />),
			);
		});
		const watchEl = container.querySelector('[data-testid="pr-watch"]');
		const btn = watchEl?.querySelector("button");
		expect(btn?.textContent).toBe("Watch");

		await act(async () => {
			btn?.click();
		});
		expect(onWatch).toHaveBeenCalledWith(pr, true);
	});

	it("shows headRef into baseRef, the merge word for blocked, and none for unknown", async () => {
		const prBlocked: PullRequestView = {
			...basePr,
			headRef: "feat/my-branch",
			baseRef: "main",
			mergeState: "blocked",
		};
		await act(async () => {
			root.render(renderWithClient(<PullRequestRow pr={prBlocked} />));
		});
		expect(
			container.querySelector('[data-testid="pr-branches"]')?.textContent,
		).toBe("feat/my-branch into main");
		expect(
			container.querySelector('[data-testid="pr-merge"]')?.textContent,
		).toBe("Merge blocked");

		const prUnknown: PullRequestView = {
			...basePr,
			headRef: "feat/other",
			baseRef: "develop",
			mergeState: "unknown",
		};
		await act(async () => {
			root.render(renderWithClient(<PullRequestRow pr={prUnknown} />));
		});
		expect(
			container.querySelector('[data-testid="pr-branches"]')?.textContent,
		).toBe("feat/other into develop");
		expect(container.querySelector('[data-testid="pr-merge"]')).toBeNull();
	});

	it("renders a Log link with exact href for each run with a url", async () => {
		const pr: PullRequestView = {
			...basePr,
			checks: { state: "failing", total: 2, failed: 1, pending: 0 },
			checkRuns: [
				{
					name: "ci/build",
					state: "failing",
					url: "https://ci.example.com/build/1",
				},
				{ name: "ci/lint", state: "passing" },
			],
		};
		await act(async () => {
			root.render(renderWithClient(<PullRequestRow pr={pr} />));
		});
		const btn = container.querySelector<HTMLButtonElement>(
			'[data-testid="pr-checks"]',
		);
		await act(async () => {
			btn?.click();
		});
		const links = container.querySelectorAll<HTMLAnchorElement>(
			'[data-testid="pr-check-log-link"]',
		);
		expect(links).toHaveLength(1);
		expect(links[0]?.getAttribute("href")).toBe(
			"https://ci.example.com/build/1",
		);
		expect(links[0]?.textContent).toBe("Log");
	});

	it("opens with checks expanded when focused with a failing run, showing step and lines from kept checkLogs", async () => {
		const pr: PullRequestView = {
			...basePr,
			checks: { state: "failing", total: 1, failed: 1, pending: 0 },
			checkRuns: [
				{ id: "run-42", name: "vitest", state: "failing", headSha: "sha-abc" },
			],
			checkLogs: [
				{
					runId: "run-42",
					headSha: "sha-abc",
					step: "Run unit tests",
					lines: [
						"FAIL test/example.test.ts",
						"AssertionError: expected 1 to be 2",
					],
					unavailable: null,
					fetchedAt: "2026-11-12T00:00:00.000Z",
				},
			],
		};
		await act(async () => {
			root.render(renderWithClient(<PullRequestRow pr={pr} focused={true} />));
		});
		const checkBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="pr-checks"]',
		);
		expect(checkBtn?.getAttribute("aria-expanded")).toBe("true");
		const tail = container.querySelector('[data-testid="pr-check-tail"]');
		expect(tail?.textContent).toContain("Failed at Run unit tests");
		const lines = container.querySelector('[data-testid="pr-check-lines"]');
		expect(lines?.textContent).toBe(
			"FAIL test/example.test.ts\nAssertionError: expected 1 to be 2",
		);
	});

	it("calls onDraft with exactly checkFixMessage when Ask the agent to fix is clicked", async () => {
		const onDraft = vi.fn();
		const run: PrCheckRun = {
			id: "run-10",
			name: "unit-tests",
			state: "failing",
			headSha: "sha-1234567",
		};
		const log: PrCheckLog = {
			runId: "run-10",
			headSha: "sha-1234567",
			step: "Run vitest",
			lines: ["Test failed: expect false to be true"],
			unavailable: null,
			fetchedAt: "2026-11-12T00:00:00.000Z",
		};
		const pr: PullRequestView = {
			...basePr,
			checks: { state: "failing", total: 1, failed: 1, pending: 0 },
			checkRuns: [run],
			checkLogs: [log],
		};
		await act(async () => {
			root.render(
				renderWithClient(
					<PullRequestRow pr={pr} focused={true} onDraft={onDraft} />,
				),
			);
		});
		const fixBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="pr-fix-check"]',
		);
		expect(fixBtn?.textContent).toBe("Ask the agent to fix");
		await act(async () => {
			fixBtn?.click();
		});
		expect(onDraft).toHaveBeenCalledTimes(1);
		expect(onDraft).toHaveBeenCalledWith(checkFixMessage(pr, run, log));
	});

	it("shows the unavailable sentence when checkLogs has an unavailable entry", async () => {
		const pr: PullRequestView = {
			...basePr,
			checks: { state: "failing", total: 1, failed: 1, pending: 0 },
			checkRuns: [
				{
					id: "run-no-access",
					name: "e2e",
					state: "failing",
					headSha: "sha-xyz",
				},
			],
			checkLogs: [
				{
					runId: "run-no-access",
					headSha: "sha-xyz",
					step: null,
					lines: [],
					unavailable: "The git host no longer keeps this log.",
					fetchedAt: "2026-11-12T00:00:00.000Z",
				},
			],
		};
		await act(async () => {
			root.render(renderWithClient(<PullRequestRow pr={pr} focused={true} />));
		});
		const unavail = container.querySelector(
			'[data-testid="pr-check-unavailable"]',
		);
		expect(unavail?.textContent).toBe("The git host no longer keeps this log.");
	});

	it("lists open review threads first, calls onOpenFile on path:line click, and displays Resolved without a fix button for resolved ones", async () => {
		const onOpenFile = vi.fn();
		const pr: PullRequestView = {
			...basePr,
			reviewThreads: [
				{
					id: "t-resolved",
					path: "src/resolved.ts",
					line: 20,
					author: "alice",
					resolved: true,
					outdated: false,
					excerpt: "All good",
					replies: 1,
				},
				{
					id: "t-open",
					path: "src/open.ts",
					line: 15,
					author: "bob",
					resolved: false,
					outdated: false,
					excerpt: "Please fix",
					replies: 0,
				},
			],
		};
		await act(async () => {
			root.render(
				renderWithClient(<PullRequestRow pr={pr} onOpenFile={onOpenFile} />),
			);
		});
		const threads = container.querySelectorAll(
			'[data-testid="pr-review-thread"]',
		);
		expect(threads).toHaveLength(2);
		expect(threads[0]?.getAttribute("data-resolved")).toBe("false");
		expect(threads[1]?.getAttribute("data-resolved")).toBe("true");

		const pathBtn = threads[0]?.querySelector<HTMLButtonElement>(
			'[data-testid="pr-review-where"]',
		);
		expect(pathBtn?.textContent).toBe("src/open.ts:15");
		await act(async () => {
			pathBtn?.click();
		});
		expect(onOpenFile).toHaveBeenCalledWith(pr, "src/open.ts", 15);

		const openFixBtn = threads[0]?.querySelector(
			'[data-testid="pr-fix-review"]',
		);
		expect(openFixBtn?.textContent).toBe("Ask the agent to fix");

		expect(threads[1]?.textContent).toContain("Resolved");
		const resolvedFixBtn = threads[1]?.querySelector(
			'[data-testid="pr-fix-review"]',
		);
		expect(resolvedFixBtn).toBeNull();
	});

	it("renders Answers incident #7: likely ... when answers are provided", async () => {
		const pr: PullRequestView = { ...basePr };
		await act(async () => {
			root.render(
				renderWithClient(
					<PullRequestRow
						pr={pr}
						answers={{
							incidentNumber: 7,
							cause: "likely connection timeout in auth service",
						}}
					/>,
				),
			);
		});
		const answersEl = container.querySelector('[data-testid="pr-answers"]');
		expect(answersEl?.textContent).toBe(
			"Answers incident #7: likely connection timeout in auth service",
		);
	});
});
