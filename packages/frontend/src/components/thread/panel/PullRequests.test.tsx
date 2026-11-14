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
import { TooltipProvider } from "@/components/ui/tooltip";
import { PrView } from "./PrView";
import {
	checksCount,
	checksLine,
	noRunsText,
	PR_TONE_WORD,
	type PrWatch,
	PullRequestRow,
	type PullRequestView,
	prMarkClass,
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
	return (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>{ui}</TooltipProvider>
		</QueryClientProvider>
	);
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

describe("noRunsText (#1101 bar 15)", () => {
	it("says the host's count when it gave no run list, so 6/6 never sits beside No checks", () => {
		expect(
			noRunsText({ state: "passing", total: 6, failed: 0, pending: 0 }),
		).toBe("6 passing, no details");
	});
	it("says none were reported when the host gave no count", () => {
		expect(noRunsText({ state: "none", total: 0, failed: 0, pending: 0 })).toBe(
			"No checks reported",
		);
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

const q = <T extends Element = Element>(sel: string) =>
	container.querySelector<T>(sel);
const qa = <T extends Element = Element>(sel: string) =>
	container.querySelectorAll<T>(sel);
async function show(ui: React.ReactNode) {
	await act(async () => {
		root.render(renderWithClient(ui));
	});
}

describe("PullRequestRow: one line that opens the PR view (sheet §3)", () => {
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
		"shows the tone word for %s and tints only its mark",
		async (tone: PrTone) => {
			await show(<PullRequestRow pr={{ ...basePr, tone }} onOpen={vi.fn()} />);
			expect(q('[data-testid="pr-tone-word"]')?.textContent).toBe(
				PR_TONE_WORD[tone],
			);
			expect(q("svg")?.getAttribute("class")).toContain(prMarkClass(tone));
		},
	);

	it("tints the error colour for failing, the warning colour for attention, and keeps the rest neutral", () => {
		expect(prMarkClass("failing")).toBe("text-danger");
		expect(prMarkClass("attention")).toBe("text-warn");
		expect(prMarkClass("ready")).toBe("text-text-3");
		expect(prMarkClass("merged")).toBe("text-text-3");
	});

	it("reads `Failing 7/9` and opens the PR's view with its id on click", async () => {
		const onOpen = vi.fn();
		const pr: PullRequestView = {
			...basePr,
			tone: "failing",
			checks: { state: "failing", total: 9, failed: 2, pending: 0 },
		};
		await show(<PullRequestRow pr={pr} onOpen={onOpen} />);
		expect(q('[data-testid="pr-tone-word"]')?.textContent).toBe("Failing 7/9");
		await act(async () => {
			q<HTMLButtonElement>('[data-testid="pr-row"] button')?.click();
		});
		expect(onOpen).toHaveBeenCalledWith("pr-1");
	});
});

describe("PrView (sheet §4)", () => {
	it("shows Merge conflict when conflicts is true", async () => {
		await show(<PrView pr={{ ...basePr, conflicts: true }} />);
		expect(q('[data-testid="pr-conflicts"]')?.textContent).toBe(
			"Merge conflict",
		);
	});

	it("shows Approved when review is approved", async () => {
		await show(<PrView pr={{ ...basePr, review: "approved" }} />);
		expect(q('[data-testid="pr-review"]')?.textContent).toBe("Approved");
	});

	it("lists checks failing first, opens the first failing one, and keeps the others one line", async () => {
		const pr: PullRequestView = {
			...basePr,
			checks: { state: "failing", total: 3, failed: 1, pending: 1 },
			checkRuns: [
				{ name: "lint", state: "passing" },
				{ name: "test", state: "failing" },
				{ name: "build", state: "pending" },
			],
		};
		await show(<PrView pr={pr} />);
		const rows = qa('[data-testid="pr-check-run"]');
		expect(Array.from(rows, (r) => r.getAttribute("data-state"))).toEqual([
			"failing",
			"pending",
			"passing",
		]);
		const toggle = q<HTMLButtonElement>('[data-testid="pr-check-toggle"]');
		expect(toggle?.getAttribute("aria-expanded")).toBe("true");
		expect(qa('[data-testid="pr-check-toggle"]')).toHaveLength(1);
		await act(async () => {
			toggle?.click();
		});
		expect(toggle?.getAttribute("aria-expanded")).toBe("false");
		expect(q('[data-testid="pr-check-tail"]')).toBeNull();
	});

	it("counts failing checks on the Checks tab and open threads on the Reviews tab", async () => {
		const pr: PullRequestView = {
			...basePr,
			checks: { state: "failing", total: 2, failed: 2, pending: 0 },
			checkRuns: [
				{ name: "a", state: "failing" },
				{ name: "b", state: "failing" },
			],
			reviewThreads: [
				{
					id: "t1",
					path: "a.ts",
					line: 1,
					author: "ann",
					resolved: false,
					outdated: false,
					excerpt: "x",
					replies: 0,
				},
			],
		};
		await show(<PrView pr={pr} />);
		expect(q('[data-testid="pr-tab-checks"]')?.textContent).toBe("Checks2");
		expect(q('[data-testid="pr-tab-reviews"]')?.textContent).toBe("Reviews1");
		expect(q('[data-testid="pr-tab-files"]')?.textContent).toBe("Files");
	});

	it("with onWatch marks it watching, reads Stop watching and calls onWatch(pr, false)", async () => {
		const onWatch = vi.fn();
		const pr: PullRequestView = { ...basePr, watch: { state: "watching" } };
		await show(<PrView pr={pr} onWatch={onWatch} />);
		const btn = q('[data-testid="pr-watch"]')?.querySelector("button");
		expect(btn?.textContent).toBe("Stop watching");
		// The watch state is a mark with its line as the accessible name (b6feb6b7b).
		expect(q('[data-testid="pr-watch-mark"]')?.getAttribute("aria-label")).toBe(
			"Watch: Watching checks and reviews",
		);
		await act(async () => {
			btn?.click();
		});
		expect(onWatch).toHaveBeenCalledWith(pr, false);
	});

	it("with onWatch reads Watch for stopped and calls onWatch(pr, true)", async () => {
		const onWatch = vi.fn();
		const pr: PullRequestView = {
			...basePr,
			watch: { state: "stopped", reason: "merged" },
		};
		await show(<PrView pr={pr} onWatch={onWatch} />);
		const btn = q('[data-testid="pr-watch"]')?.querySelector("button");
		expect(btn?.textContent).toBe("Watch");
		await act(async () => {
			btn?.click();
		});
		expect(onWatch).toHaveBeenCalledWith(pr, true);
	});

	it("shows headRef into baseRef, the merge word for blocked, and none for unknown", async () => {
		await show(
			<PrView
				pr={{
					...basePr,
					headRef: "feat/my-branch",
					baseRef: "main",
					mergeState: "blocked",
				}}
			/>,
		);
		expect(q('[data-testid="pr-branches"]')?.textContent).toBe(
			"feat/my-branch into main",
		);
		expect(q('[data-testid="pr-merge"]')?.textContent).toBe("Merge blocked");
		await show(
			<PrView
				pr={{
					...basePr,
					headRef: "feat/other",
					baseRef: "develop",
					mergeState: "unknown",
				}}
			/>,
		);
		expect(q('[data-testid="pr-branches"]')?.textContent).toBe(
			"feat/other into develop",
		);
		expect(q('[data-testid="pr-merge"]')).toBeNull();
	});

	it("links each run that has a url to its log: the open failing run's Open log on the host, and a passing run with no log id by its whole line", async () => {
		const pr: PullRequestView = {
			...basePr,
			checks: { state: "failing", total: 3, failed: 1, pending: 0 },
			checkRuns: [
				{
					name: "ci/build",
					state: "failing",
					url: "https://ci.example.com/b/1",
				},
				{
					name: "ci/lint",
					state: "passing",
					url: "https://ci.example.com/l/2",
				},
				{ name: "ci/docs", state: "passing" },
			],
		};
		await show(<PrView pr={pr} />);
		const links = qa<HTMLAnchorElement>('[data-testid="pr-check-log-link"]');
		expect(Array.from(links, (a) => a.getAttribute("href"))).toEqual([
			"https://ci.example.com/b/1",
			"https://ci.example.com/l/2",
		]);
		// d0739b420 named the host, since Open log now reads a check's log in place.
		expect(links[0]?.textContent).toBe("Open log on the host");
	});

	it("shows the open failing run's step and lines from kept checkLogs", async () => {
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
		await show(<PrView pr={pr} />);
		expect(q('[data-testid="pr-check-tail"]')?.textContent).toContain(
			"Failed at Run unit tests",
		);
		expect(q('[data-testid="pr-check-lines"]')?.textContent).toBe(
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
		await show(<PrView pr={pr} onDraft={onDraft} />);
		const fix = q<HTMLButtonElement>('[data-testid="pr-fix-check"]');
		expect(fix?.textContent).toBe("Ask the agent to fix");
		await act(async () => {
			fix?.click();
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
		await show(<PrView pr={pr} />);
		expect(q('[data-testid="pr-check-unavailable"]')?.textContent).toBe(
			"The git host no longer keeps this log.",
		);
	});

	it("lists open review threads first with their excerpt; opening one jumps to path:line and offers a fix only when unresolved", async () => {
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
		await show(<PrView pr={pr} initialTab="reviews" onOpenFile={onOpenFile} />);
		const threads = qa('[data-testid="pr-review-thread"]');
		expect(Array.from(threads, (t) => t.getAttribute("data-resolved"))).toEqual(
			["false", "true"],
		);
		// d0739b420 put the comment's start under each closed row.
		expect(threads[0]?.textContent).toBe("src/open.ts:15bob · OpenPlease fix");
		expect(threads[1]?.textContent).toBe(
			"src/resolved.ts:20alice · ResolvedAll good",
		);
		const toggles = qa<HTMLButtonElement>('[data-testid="pr-review-toggle"]');
		await act(async () => {
			toggles[0]?.click();
			toggles[1]?.click();
		});
		const jump = threads[0]?.querySelector<HTMLButtonElement>(
			'[data-testid="pr-review-where"]',
		);
		expect(jump?.textContent).toBe("Open src/open.ts:15");
		await act(async () => {
			jump?.click();
		});
		expect(onOpenFile).toHaveBeenCalledWith(pr, "src/open.ts", 15);
		expect(
			threads[0]?.querySelector('[data-testid="pr-fix-review"]')?.textContent,
		).toBe("Ask the agent to fix");
		expect(
			threads[1]?.querySelector('[data-testid="pr-fix-review"]'),
		).toBeNull();
	});

	it("renders Answers incident #7: likely ... when answers are provided", async () => {
		await show(
			<PrView
				pr={basePr}
				answers={{
					incidentNumber: 7,
					cause: "likely connection timeout in auth service",
				}}
			/>,
		);
		expect(q('[data-testid="pr-answers"]')?.textContent).toBe(
			"Answers incident #7: likely connection timeout in auth service",
		);
	});

	it("calls onBack from its Back button", async () => {
		const onBack = vi.fn();
		await show(<PrView pr={basePr} onBack={onBack} />);
		await act(async () => {
			q<HTMLButtonElement>('[data-testid="pr-view-back"]')?.click();
		});
		expect(onBack).toHaveBeenCalledTimes(1);
	});
});
