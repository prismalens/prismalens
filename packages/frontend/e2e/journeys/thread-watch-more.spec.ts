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
 * #1020 S2: thread watch journeys on the standalone thread page (/threads/$id).
 * Panel default/persistence, status box project/branch, worktree diff list and
 * unavailable empty state, untrusted text rendering, and reduced motion.
 */
const THREAD_ID = "f7777777-7777-4777-8777-777777777777";
const REPO_ID = "f8888888-8888-4888-8888-888888888888";
const CWD = "/tmp/worktrees/pl-f7777777";
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

interface ThreadState {
	status: string;
	kind?: string;
	repositoryId?: string | null;
	title?: string;
	events: CanonicalEvent[];
	changes: WorktreeChanges;
}

async function serveThread(page: Page, state: ThreadState): Promise<void> {
	const row = () => ({
		id: THREAD_ID,
		incidentId: null,
		serviceId: null,
		scheduleId: null,
		repositoryId: state.repositoryId ?? null,
		subject: "project",
		status: state.status,
		kind: state.kind ?? "chat",
		title: state.title ?? "Add backoff to retries",
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
					branch: "prismalens/shop-f7777777",
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
	if (state.repositoryId) {
		await page.route(
			(url) => url.pathname === `/api/repositories/${state.repositoryId}`,
			(route) =>
				route.fulfill(
					json({
						id: state.repositoryId,
						connectionId: null,
						sourceKind: "folder",
						fullName: "prismalens/shop",
						url: "/code/shop",
						description: null,
						language: "typescript",
						defaultBranch: "main",
						isPrivate: false,
						metadata: null,
						syncBranch: null,
						syncHead: null,
						syncError: null,
						syncedAt: null,
						createdAt: at(0),
						updatedAt: at(0),
						services: [],
					}),
				),
		);
	}
}

const CHANGED_WITH_UNTRACKED: WorktreeChanges = {
	repos: [
		{
			state: "ok",
			repo: "repo",
			base: HEAD,
			branch: "prismalens/shop-f7777777",
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
					additions: 12,
					deletions: 0,
				},
			],
			additions: 89,
			deletions: 3,
			patch:
				"diff --git a/src/pay/retry.ts b/src/pay/retry.ts\n--- a/src/pay/retry.ts\n+++ b/src/pay/retry.ts\n@@ -1 +1 @@\n-retry()\n+retry({ backoff })\n",
			omitted: null,
			truncated: false,
		},
	],
};

const DELETED_WORKSPACE_CHANGES: WorktreeChanges = {
	repos: [
		{
			state: "unavailable",
			repo: "repo",
			reason: "removed",
		},
	],
};

test.describe("#1020 S2 — watch a thread work (more journeys)", () => {
	test.beforeEach(({ page }) => hideQueryDevtools(page));

	test("1. the right panel never opens itself: closed after load and reload, opens on toggle with empty surface and tabs Files, Diff, Browser", async ({
		page,
	}) => {
		seq = 0;
		const state: ThreadState = {
			status: "running",
			changes: CHANGED_WITH_UNTRACKED,
			events: [operator(0, "Add backoff to retries")],
		};
		await installStreamDouble(page);
		await serveThread(page, state);
		await page.goto(`/threads/${THREAD_ID}`);
		await expect(page.getByTestId("thread-page")).toBeVisible({
			timeout: 15_000,
		});

		// Header toggle is present immediately (no late pop-in) and panel is closed
		const panelToggle = page.getByRole("button", { name: "Panel" });
		await expect(panelToggle).toBeVisible();
		await expect(page.getByTestId("thread-panel")).toHaveCount(0);

		// After reload, panel remains closed and toggle is present immediately
		await page.reload();
		await expect(page.getByTestId("thread-page")).toBeVisible({
			timeout: 15_000,
		});
		await expect(panelToggle).toBeVisible();
		await expect(page.getByTestId("thread-panel")).toHaveCount(0);

		// Toggle opens the panel
		await panelToggle.click();
		await expect(page.getByTestId("thread-panel")).toBeVisible();

		// One panel (#1024): Thread and Changes; Browser only after a page opened, no Suspects here.
		await expect(page.getByRole("tab", { name: "Thread" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(page.getByRole("tab", { name: "Changes" })).toBeVisible();
		await expect(page.getByRole("tab", { name: "Browser" })).toHaveCount(0);
		await expect(page.getByRole("tab", { name: "Suspects" })).toHaveCount(0);
	});

	test("2. the status box is closed by default and opens on click, showing project and branch", async ({
		page,
	}) => {
		seq = 0;
		const state: ThreadState = {
			status: "running",
			repositoryId: REPO_ID,
			changes: CHANGED_WITH_UNTRACKED,
			events: [operator(0, "Add backoff to retries")],
		};
		await installStreamDouble(page);
		await serveThread(page, state);
		await page.goto(`/threads/${THREAD_ID}`);
		await expect(page.getByTestId("thread-page")).toBeVisible({
			timeout: 15_000,
		});

		// Status box is closed by default
		await expect(page.getByTestId("status-box")).toHaveCount(0);

		// Header toggle for Status is present
		const statusToggle = page.getByRole("button", { name: "Status" });
		await expect(statusToggle).toBeVisible();

		// Opens on click
		await statusToggle.click();
		await expect(page.getByTestId("status-box")).toBeVisible();

		// Showing project and branch
		await expect(page.getByTestId("status-project")).toHaveText(
			"prismalens/shop",
		);
		await expect(page.getByTestId("status-branch")).toHaveText(
			"prismalens/shop-f7777777",
		);
	});

	test("3. diff tab lists edited and untracked new files, and shows an empty state for a deleted workspace", async ({
		page,
	}) => {
		seq = 0;
		const state: ThreadState = {
			status: "running",
			changes: CHANGED_WITH_UNTRACKED,
			events: [operator(0, "Add backoff to retries")],
		};
		await installStreamDouble(page);
		await serveThread(page, state);
		await page.goto(`/threads/${THREAD_ID}`);
		await expect(page.getByTestId("thread-page")).toBeVisible({
			timeout: 15_000,
		});

		// Open panel and select Changes: files and the diff together (#1024)
		await page.getByRole("button", { name: "Panel" }).click();
		await expect(page.getByTestId("thread-panel")).toBeVisible();
		await page.getByRole("tab", { name: "Changes" }).click();
		await expect(page.getByTestId("worktree-diff")).toBeVisible();

		// Both edited file and untracked new file are listed
		const diffFiles = page.getByTestId("diff-file");
		await expect(diffFiles).toHaveCount(2);
		const modifiedFile = diffFiles.filter({ hasText: "src/pay/retry.ts" });
		await expect(modifiedFile).toBeVisible();
		await expect(modifiedFile).toHaveAttribute("data-status", "modified");

		const addedFile = diffFiles.filter({ hasText: "src/pay/backoff.ts" });
		await expect(addedFile).toBeVisible();
		await expect(addedFile).toHaveAttribute("data-status", "added");
		await expect(addedFile).toContainText("new");

		// Switch changes to deleted workspace
		state.changes = DELETED_WORKSPACE_CHANGES;
		await page.reload();
		await expect(page.getByTestId("thread-page")).toBeVisible({
			timeout: 15_000,
		});
		// The panel's tab is in the URL (#1024): the reload reopens Changes.
		await expect(page.getByRole("tab", { name: "Changes" })).toHaveAttribute(
			"aria-selected",
			"true",
		);

		// A deleted workspace shows an empty state (not an error page)
		await expect(page.getByTestId("diff-unavailable")).toBeVisible();
		await expect(page.getByTestId("diff-unavailable")).toHaveText(
			"Workspace removed",
		);
		await expect(page.getByTestId("state-problem")).toHaveCount(0);
		await expect(page.getByTestId("state-not-found")).toHaveCount(0);
		await expect(page.getByRole("alert")).toHaveCount(0);
	});

	test("4. untrusted text in title or step line renders as plain text without creating elements or dialogs", async ({
		page,
	}) => {
		seq = 0;
		const xssPayload = "<img src=x onerror=alert(1)>";
		let dialogFired = false;
		page.on("dialog", (dialog) => {
			dialogFired = true;
			void dialog.dismiss();
		});

		const state: ThreadState = {
			status: "running",
			title: xssPayload,
			changes: CHANGED_WITH_UNTRACKED,
			events: [
				operator(0, "Investigate security issue"),
				{
					kind: "agent_step",
					...base(5),
					text: "",
					toolCalls: [
						{
							toolCallId: "c-xss-cmd",
							name: "Bash",
							args: { command: xssPayload },
						},
					],
				} as CanonicalEvent,
				{
					kind: "tool_result",
					...base(6),
					result: {
						name: "Bash",
						toolCallId: "c-xss-cmd",
						source: `Bash(${xssPayload})`,
						ok: true,
						preview: "echo done",
					},
				} as CanonicalEvent,
			],
		};

		await installStreamDouble(page);
		await serveThread(page, state);
		await page.goto(`/threads/${THREAD_ID}`);
		await expect(page.getByTestId("thread-page")).toBeVisible({
			timeout: 15_000,
		});

		// Title renders as plain text
		const title = page.getByTestId("thread-title");
		await expect(title).toHaveText(xssPayload);

		// Step line renders as plain text
		await expect(page.getByTestId("transcript-tools")).toHaveAttribute(
			"data-folded",
			"",
		);
		await page.getByTestId("tools-expand").first().click();
		const step = page.locator('[data-testid="step"][data-node="command"]');
		await expect(step).toBeVisible();
		await expect(step.getByText(xssPayload)).toBeVisible();

		// No <img> element created for the payload
		await expect(page.locator("img[src='x']")).toHaveCount(0);
		await expect(page.locator("img")).toHaveCount(0);

		// No alert/dialog fired
		expect(dialogFired).toBe(false);
	});

	test("5. reduced motion: with page.emulateMedia({reducedMotion: 'reduce'}) no running CSS animation on the transcript", async ({
		page,
	}) => {
		seq = 0;
		await page.emulateMedia({ reducedMotion: "reduce" });

		const state: ThreadState = {
			status: "running",
			changes: CHANGED_WITH_UNTRACKED,
			events: [
				operator(0, "Add backoff to retries"),
				{
					kind: "agent_step",
					...base(5),
					text: "Analyzing code",
					toolCalls: [],
				} as CanonicalEvent,
			],
		};

		await installStreamDouble(page);
		await serveThread(page, state);
		await page.goto(`/threads/${THREAD_ID}`);
		await expect(page.getByTestId("thread-page")).toBeVisible({
			timeout: 15_000,
		});

		const transcript = page.getByTestId("transcript");
		await expect(transcript).toBeVisible();

		// Check getAnimations().length === 0 on the transcript region
		const runningAnims = await transcript.evaluate((el) => {
			return el
				.getAnimations({ subtree: true })
				.filter((a) => a.playState === "running").length;
		});
		expect(runningAnims).toBe(0);

		const totalAnims = await transcript.evaluate((el) => {
			return el.getAnimations({ subtree: true }).length;
		});
		expect(totalAnims).toBe(0);

		const directAnims = await transcript.evaluate((el) => {
			return el.getAnimations().length;
		});
		expect(directAnims).toBe(0);
	});
});
