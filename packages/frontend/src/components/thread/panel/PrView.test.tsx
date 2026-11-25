// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PrCheckLog, PrCheckRun, ThreadLink } from "@prismalens/contracts";
import { act, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type RenderedApp, renderWithApp } from "@/test/render";
import { PrView } from "./PrView";
import type { PullRequestView } from "./PullRequests";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const threadLinksState = vi.hoisted(() => ({
	links: [] as ThreadLink[],
}));

const settingsState = vi.hoisted(() => ({
	rerunChecks: false,
}));

vi.mock("@/lib/api/hooks/use-thread-tree-orpc", () => ({
	useThreadLinks: () => ({
		data: { started: threadLinksState.links },
		isLoading: false,
	}),
}));

vi.mock("@/lib/api/hooks/use-app-settings-orpc", () => ({
	useThreadContextSettings: () => ({
		data: { rerunChecks: settingsState.rerunChecks },
		isLoading: false,
	}),
}));

vi.mock("@/lib/api/hooks/use-pr-subscriptions", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/lib/api/hooks/use-pr-subscriptions")
	>()),
	usePrSubscriptions: () => ({
		data: { subscriptions: [] },
		isPending: false,
		isError: false,
	}),
}));

/** A kept log for `runId`, so the open row reads no log from the API. */
const keptLog = (runId: string, headSha: string | null = null): PrCheckLog => ({
	runId,
	headSha,
	step: "Run it",
	lines: ["failed"],
	unavailable: null,
	fetchedAt: "2026-11-18T00:00:00.000Z",
});

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		params,
		...props
	}: {
		children: ReactNode;
		to?: string;
		params?: Record<string, string>;
	}) => {
		let href = to ?? "";
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				href = href.replace(`$${k}`, v);
			}
		}
		return (
			<a href={href} {...props}>
				{children}
			</a>
		);
	},
}));

let container: HTMLDivElement;
let app: RenderedApp | undefined;

beforeEach(() => {
	app = undefined;
	threadLinksState.links = [];
	settingsState.rerunChecks = false;
});

async function show(ui: React.ReactNode) {
	if (app) await app.rerender(ui);
	else app = await renderWithApp(ui);
	container = app.container;
}

const basePr: PullRequestView = {
	id: "pr-1",
	number: 42,
	host: "github",
	can: { rerunCheck: true },
	repo: "acme/shop",
	title: "feat: new feature",
	url: "https://github.com/acme/shop/pull/42",
	state: "open",
	tone: "open",
	checks: { state: "failing", total: 10, failed: 2, pending: 0 },
	review: "none",
	conflicts: false,
	source: "branch",
	fetchedAt: null,
};

describe("PrView (#1176)", () => {
	it("renders failing rows first with their log, the others line and more on host link", async () => {
		const runs: PrCheckRun[] = [
			{ id: "run-pass", name: "lint", state: "passing" },
			{ id: "run-fail-1", name: "e2e-tests", state: "failing" },
			{ id: "run-fail-2", name: "unit-tests", state: "failing" },
		];
		const logs: PrCheckLog[] = [
			{
				runId: "run-fail-1",
				headSha: null,
				step: "Run vitest",
				lines: ["FAIL src/example.test.ts", "Expected true to be false"],
				unavailable: null,
				fetchedAt: "2026-11-18T00:00:00.000Z",
			},
		];
		const pr: PullRequestView = {
			...basePr,
			checks: { state: "failing", total: 10, failed: 2, pending: 0 },
			checkRuns: runs,
			checkLogs: logs,
		};

		await show(<PrView pr={pr} />);

		const renderedRuns = container.querySelectorAll(
			'[data-testid="pr-check-run"]',
		);
		expect(renderedRuns).toHaveLength(2);
		expect(renderedRuns[0]?.getAttribute("data-name")).toBe("e2e-tests");
		expect(renderedRuns[1]?.getAttribute("data-name")).toBe("unit-tests");

		// First failing check opens by default and shows its log
		expect(
			container.querySelector('[data-testid="pr-check-tail"]')?.textContent,
		).toContain("Failed at Run vitest");
		expect(
			container.querySelector('[data-testid="pr-check-lines"]')?.textContent,
		).toBe("FAIL src/example.test.ts\nExpected true to be false");

		// "{n} other checks" line where n = total - failed = 10 - 2 = 8
		const othersBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="pr-others-line"]',
		);
		expect(othersBtn?.textContent).toContain("8 other checks");

		// Expanding "{n} other checks" shows "{k} more on the host"
		// 8 others, 1 kept passing run => 7 more on host
		await act(async () => {
			othersBtn?.click();
		});

		const moreLink = container.querySelector('[data-testid="pr-others-more"]');
		expect(moreLink?.textContent).toContain("7 more on the host");
		expect(moreLink?.getAttribute("href")).toBe(pr.url);
	});

	it("shows Cancelled label and does not offer a fix button on a cancelled row", async () => {
		const run: PrCheckRun = {
			id: "run-cancel",
			name: "deploy-preview",
			state: "failing",
			cancelled: true,
		};
		const pr: PullRequestView = {
			...basePr,
			checks: { state: "failing", total: 1, failed: 1, pending: 0 },
			checkRuns: [run],
			checkLogs: [keptLog(run.id ?? "")],
		};

		await show(<PrView pr={pr} threadId="thread-1" />);

		const cancelledBadge = container.querySelector(
			'[data-testid="pr-check-cancelled"]',
		);
		expect(cancelledBadge?.textContent).toBe("Cancelled");

		// The row is open by default: should not have a "Fix in a new thread" or "Go to thread" button
		expect(container.querySelector('[data-testid="pr-fix-thread"]')).toBeNull();
		expect(container.querySelector('[data-testid="pr-fix-go-to"]')).toBeNull();
	});

	it('shows "Go to thread" on a covered finding', async () => {
		const run: PrCheckRun = {
			id: "run-covered",
			name: "build",
			appId: "CI",
			state: "failing",
			headSha: "sha123",
		};
		const pr: PullRequestView = {
			...basePr,
			headSha: "sha123",
			checks: { state: "failing", total: 1, failed: 1, pending: 0 },
			checkRuns: [run],
			checkLogs: [keptLog(run.id ?? "", "sha123")],
		};
		// Set covering fix thread link in mock
		threadLinksState.links = [
			{
				id: "fix-thread-456",
				via: "fix",
				state: "running",
				status: "working",
				title: "Fix build",
				link: "/threads/fix-thread-456",
				unread: 0,
				fix: {
					prId: pr.id,
					headSha: "sha123",
					items: [{ kind: "check", ident: "CI::build" }],
				},
			},
		];

		await show(<PrView pr={pr} threadId="thread-1" />);

		const goTo = container.querySelector('[data-testid="pr-fix-go-to"]');
		expect(goTo).not.toBeNull();
		expect(goTo?.textContent).toContain("Go to thread");
		expect(goTo?.getAttribute("href")).toBe("/threads/fix-thread-456");
		expect(container.querySelector('[data-testid="pr-fix-thread"]')).toBeNull();
	});

	it('renders "Ask this thread" only when own is true', async () => {
		const run: PrCheckRun = {
			id: "run-1",
			name: "typecheck",
			state: "failing",
		};
		const pr: PullRequestView = {
			...basePr,
			checks: { state: "failing", total: 1, failed: 1, pending: 0 },
			checkRuns: [run],
		};

		// When own is false / omitted
		await show(<PrView pr={pr} own={false} />);
		expect(container.querySelector('[data-testid="pr-fix-check"]')).toBeNull();

		// When own is true
		await show(<PrView pr={pr} own={true} />);
		const askBtn = container.querySelector('[data-testid="pr-fix-check"]');
		expect(askBtn).not.toBeNull();
		expect(askBtn?.textContent).toBe("Ask this thread");
	});

	it("disables Re-run when the setting is off", async () => {
		const run: PrCheckRun = {
			id: "run-rerun",
			name: "unit-tests",
			state: "failing",
			rerunnable: true,
		};
		const pr: PullRequestView = {
			...basePr,
			checks: { state: "failing", total: 1, failed: 1, pending: 0 },
			checkRuns: [run],
			checkLogs: [keptLog(run.id ?? "")],
		};

		settingsState.rerunChecks = false;
		await show(<PrView pr={pr} threadId="thread-1" />);

		const rerunBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="rerun-button"]',
		);
		expect(rerunBtn).not.toBeNull();
		expect(rerunBtn?.disabled).toBe(true);
		expect(rerunBtn?.getAttribute("data-blocked")).toBe("Re-run is off");

		// When setting is enabled
		settingsState.rerunChecks = true;
		await show(<PrView pr={pr} threadId="thread-1" />);

		const rerunBtnActive = container.querySelector<HTMLButtonElement>(
			'[data-testid="rerun-button"]',
		);
		expect(rerunBtnActive?.disabled).toBe(false);
		expect(rerunBtnActive?.getAttribute("data-blocked")).toBeNull();
	});
});
