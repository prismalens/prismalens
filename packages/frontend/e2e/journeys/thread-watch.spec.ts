// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import type { CanonicalEvent, WorktreeChanges } from "@prismalens/contracts";
import {
	hideQueryDevtools,
	installStreamDouble,
	RUN_ID,
} from "./live-stream-fixtures";

/**
 * #1020 S2: watching a thread work. The typed spine (commands, edits, PrismaLens
 * tools with their outcome), findings, the inline ask mirrored in the dock, the
 * finished-turn fold, "answered", the status box and the right panel, both closed
 * until opened, and the live diff with its removed-workspace state.
 */
const THREAD_ID = "f5555555-5555-4555-8555-555555555555";
const ASK_ID = "f6666666-6666-4666-8666-666666666666";
const CWD = "/tmp/worktrees/pl-f5555555";
const HEAD = "abc123def4567890abc123def4567890abc12345";
const T0 = Date.now() - 10 * 60_000;
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

let seq = 0;
const base = (s: number) => ({
	runId: RUN_ID,
	branchId: "main",
	path: [] as string[],
	seq: seq++,
	ts: at(s),
	label: null,
});

function operator(s: number, text: string, delivered = true): CanonicalEvent {
	return {
		kind: "operator_message",
		...base(s),
		text,
		mode: "queue",
		delivered,
	} as CanonicalEvent;
}

function work(s: number): CanonicalEvent[] {
	return [
		{
			kind: "agent_step",
			...base(s),
			text: "",
			toolCalls: [
				{
					toolCallId: "c-cmd",
					name: "Bash",
					args: { command: "pnpm test src/pay" },
				},
				{
					toolCallId: "c-edit",
					name: "Edit",
					args: { file_path: `${CWD}/src/pay/retry.ts` },
				},
				{
					toolCallId: "c-pl",
					name: "mcp__prismalens-1__incidents_similar",
					args: {},
				},
			],
		},
		{
			kind: "tool_result",
			...base(s + 1),
			result: {
				name: "Bash",
				toolCallId: "c-cmd",
				source: "Bash(pnpm test src/pay)",
				ok: true,
				preview: "3 passed",
			},
		},
		{
			kind: "tool_result",
			...base(s + 2),
			result: {
				name: "Edit",
				toolCallId: "c-edit",
				toolCategory: "file",
				source: "Edit(src/pay/retry.ts)",
				ok: true,
				preview: "ok",
			},
		},
		{
			kind: "harness_tool_call",
			...base(s + 3),
			server: "prismalens-1",
			name: "incidents_similar",
			at: at(s + 3),
			turn: "first",
			output: "INC-7 retry storm\nmore lines",
		},
		{
			kind: "tool_result",
			...base(s + 4),
			result: {
				name: "mcp__prismalens-1__incidents_similar",
				toolCallId: "c-pl",
				source: "incidents_similar",
				ok: true,
				preview: "INC-7",
			},
		},
		{
			kind: "finding_recorded",
			...base(s + 5),
			finding: {
				type: "evidence",
				id: "e1",
				observation: "Retries have no backoff",
				source: "src/pay/retry.ts",
				quote: "retry()",
				direction: "supports",
				anchor: null,
				at: at(s + 5),
			},
		},
	] as CanonicalEvent[];
}

interface ThreadState {
	status: string;
	kind?: string;
	events: CanonicalEvent[];
	changes: WorktreeChanges;
}

async function serveThread(page: Page, state: ThreadState): Promise<void> {
	const row = () => ({
		id: THREAD_ID,
		incidentId: null,
		serviceId: null,
		scheduleId: null,
		repositoryId: null,
		subject: "none",
		status: state.status,
		kind: state.kind ?? "chat",
		title: "Add backoff to retries",
		accessLevel: "supervised",
		harness: null,
		model: null,
		effort: null,
		hasReport: false,
		startedAt: at(0),
		completedAt: state.status === "running" ? null : at(400),
		summary: null,
		rootCause: null,
		rootCauseCategory: null,
		report: null,
		error: null,
		liveTurn: state.status === "running" ? "answer" : null,
		workspace: {
			layout: "single",
			cwd: CWD,
			repos: [
				{
					name: "repo",
					dir: CWD,
					sourceKind: "folder",
					url: "/code/shop",
					subPath: null,
					connectionId: null,
					head: HEAD,
					branch: "prismalens/shop-f5555555",
					services: [],
				},
			],
		},
		resumable: state.status !== "running",
		resumeBlockedReason: null,
		continuable: false,
		createdAt: at(0),
		updatedAt: at(0),
	});
	const json = (body: unknown) => ({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify(body),
	});
	await page.route(
		(url) => url.pathname === `/api/investigations/${THREAD_ID}`,
		(route) => route.fulfill(json(row())),
	);
	await page.route(
		(url) => url.pathname === `/api/investigations/${THREAD_ID}/status`,
		(route) => route.fulfill(json({ investigation: row(), job: null })),
	);
	await page.route(
		(url) => url.pathname === `/api/investigations/${THREAD_ID}/events`,
		(route) => route.fulfill(json({ events: state.events, nextCursor: null })),
	);
	await page.route(
		(url) => url.pathname === `/api/investigations/${THREAD_ID}/changes`,
		(route) => route.fulfill(json(state.changes)),
	);
	await page.route(
		(url) => url.pathname === `/api/investigations/${THREAD_ID}/workspaces`,
		(route) => route.fulfill(json({ workspaces: [], canEdit: false })),
	);
}

const CHANGED: WorktreeChanges = {
	repos: [
		{
			state: "ok",
			repo: "repo",
			base: HEAD,
			branch: "prismalens/shop-f5555555",
			files: [
				{
					path: "src/pay/retry.ts",
					status: "modified",
					additions: 77,
					deletions: 3,
				},
				{
					path: "src/pay/backoff.ts",
					status: "added",
					additions: 0,
					deletions: 0,
				},
			],
			additions: 77,
			deletions: 3,
			patch:
				"diff --git a/src/pay/retry.ts b/src/pay/retry.ts\n--- a/src/pay/retry.ts\n+++ b/src/pay/retry.ts\n@@ -1 +1 @@\n-retry()\n+retry({ backoff })\n",
			omitted: null,
			truncated: false,
		},
	],
};

test.describe("#1020 S2 — watch a thread work", () => {
	test.beforeEach(({ page }) => hideQueryDevtools(page));

	test("typed steps, a finding, the ask inline and in the dock; status box and panel only when opened", async ({
		page,
	}) => {
		seq = 0;
		const state: ThreadState = {
			status: "running",
			changes: CHANGED,
			events: [
				operator(0, "Add backoff to retries"),
				...work(5),
				{
					kind: "permission_ask",
					...base(20),
					askId: ASK_ID,
					title: "pnpm test",
					detail: "pnpm test",
					toolKind: "execute",
					expiresAt: new Date(Date.now() + 600_000).toISOString(),
				} as CanonicalEvent,
			],
		};
		await installStreamDouble(page);
		await serveThread(page, state);
		await page.goto(`/threads/${THREAD_ID}`);
		await expect(page.getByTestId("thread-page")).toBeVisible({
			timeout: 15_000,
		});

		// The spine: each step drawn by what it is; a PrismaLens tool says what came back.
		await expect(
			page.locator('[data-testid="step"][data-node="command"]'),
		).toBeVisible();
		await expect(
			page.locator('[data-testid="step"][data-node="edit"]'),
		).toBeVisible();
		const pl = page.locator('[data-testid="step"][data-node="knowledge"]');
		await expect(pl.getByTestId("step-outcome")).toHaveText(
			"INC-7 retry storm",
		);
		const evidence = page.locator(
			'[data-testid="transcript-finding"][data-type="evidence"]',
		);
		await expect(evidence).toContainText("Retries have no backoff");
		await expect(evidence.getByTestId("finding-unverified")).toHaveText(
			"Unverified",
		);

		// The ask waits inline where it was asked, and in the dock.
		await expect(page.getByTestId("inline-ask")).toBeVisible();
		await expect(page.getByTestId("dock-ask")).toBeVisible();

		// Closed by default; the toggles are in the header from the start.
		await expect(page.getByTestId("status-box")).toHaveCount(0);
		await expect(page.getByTestId("thread-panel")).toHaveCount(0);
		await page.getByTestId("panel-toggle").click();
		await expect(page.getByTestId("surface-empty")).toHaveText(
			"Open a surface",
		);
		await expect(page.getByTestId("surface-suspects")).toHaveCount(0);
		await page.getByTestId("panel-toggle").click();
		await expect(page.getByTestId("thread-panel")).toHaveCount(0);

		// The status box shows the branch and the changes; the changes open the Diff.
		await page.getByTestId("status-box-toggle").click();
		await expect(page.getByTestId("status-branch")).toHaveText(
			"prismalens/shop-f5555555",
		);
		await expect(page.getByTestId("status-changes")).toHaveText("+77 −3");
		await page.getByTestId("status-changes").click();
		await expect(page.getByTestId("surface-diff")).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(page.getByTestId("diff-file")).toHaveCount(2);
		await expect(page.getByTestId("diff-patch")).toContainText(
			"retry({ backoff })",
		);
	});

	test("a finished thread folds its work, prints Answered, and a removed workspace says so", async ({
		page,
	}) => {
		seq = 0;
		const state: ThreadState = {
			status: "completed",
			changes: {
				repos: [{ state: "unavailable", repo: "repo", reason: "removed" }],
			},
			events: [
				operator(0, "Add backoff to retries"),
				...work(5),
				{
					kind: "agent_step",
					...base(200),
					text: "Added backoff to the retry helper.",
					toolCalls: [],
				} as CanonicalEvent,
				operator(250, "Did the tests pass?"),
				{
					kind: "agent_step",
					...base(260),
					text: "Yes, all 3 passed.",
					toolCalls: [],
				} as CanonicalEvent,
			],
		};
		await serveThread(page, state);
		await page.goto(`/threads/${THREAD_ID}`);
		await expect(page.getByTestId("thread-page")).toBeVisible({
			timeout: 15_000,
		});

		const fold = page.getByTestId("turn-fold");
		await expect(fold).toHaveText(/^Worked for /);
		await expect(page.getByTestId("step")).toHaveCount(0);
		await expect(
			page.getByText("Added backoff to the retry helper."),
		).toBeVisible();
		await expect(page.getByTestId("transcript-delivery").nth(1)).toHaveText(
			"answered",
		);
		await fold.click();
		await expect(page.getByTestId("step")).toHaveCount(3);

		await page.getByTestId("status-box-toggle").click();
		await expect(page.getByTestId("status-changes-none")).toHaveText(
			"Workspace gone",
		);
		await page.getByTestId("panel-toggle").click();
		await page.getByTestId("surface-diff").click();
		await expect(page.getByTestId("diff-unavailable")).toHaveText(
			"Workspace removed",
		);
	});
});
