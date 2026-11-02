// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import type { CanonicalEvent } from "@prismalens/contracts";
import {
	deliver,
	eventFactory,
	hideQueryDevtools,
	installStreamDouble,
	RUN_ID,
} from "./live-stream-fixtures";

/**
 * #1020: a project thread end to end. Add a project, start a thread on it, the agent
 * edits a file and asks to run a command, approve, stop, reload, then resume in the
 * same run and workspace. The project is real; the agent is the stream double.
 */
const THREAD_ID = "f1111111-1111-4111-8111-111111111111";
const ASK_ID = "f2222222-2222-4222-8222-222222222222";
const CWD = "/tmp/worktrees/pl-f1111111";

interface ThreadState {
	status: string;
	repositoryId: string | null;
	events: CanonicalEvent[];
}

/** The thread's run as the API would serve it, from the state the test holds. */
async function serveThread(page: Page, state: ThreadState): Promise<void> {
	const row = () => ({
		id: THREAD_ID,
		incidentId: null,
		serviceId: null,
		scheduleId: null,
		repositoryId: state.repositoryId,
		subject: "project",
		status: state.status,
		kind: "chat",
		title: "Rename retryOnce to retry",
		accessLevel: "supervised",
		harness: null,
		model: null,
		effort: null,
		hasReport: false,
		startedAt: new Date().toISOString(),
		completedAt: state.status === "running" ? null : new Date().toISOString(),
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
					head: "abc123def4567890",
					branch: "prismalens/shop-f1111111",
					services: [],
				},
			],
		},
		resumable: state.status !== "running",
		resumeBlockedReason: null,
		continuable: false,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});
	await page.route(
		(url) => url.pathname === `/api/investigations/${THREAD_ID}`,
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(row()),
			}),
	);
	await page.route(
		(url) => url.pathname === `/api/investigations/${THREAD_ID}/status`,
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ investigation: row(), job: null }),
			}),
	);
	await page.route(
		(url) => url.pathname === `/api/investigations/${THREAD_ID}/events`,
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ events: state.events, nextCursor: null }),
			}),
	);
}

test.describe("#1020 — a project thread", () => {
	test.beforeEach(({ page }) => hideQueryDevtools(page));

	test("add a project, start a thread, approve an edit, stop, reload, resume in the same workspace", async ({
		page,
	}) => {
		const state: ThreadState = {
			status: "running",
			repositoryId: null,
			events: [],
		};
		await installStreamDouble(page);
		await serveThread(page, state);
		let started: Record<string, unknown> | null = null;
		await page.route(
			(url) => url.pathname === "/api/threads",
			async (route) => {
				if (route.request().method() !== "POST") return route.fallback();
				started = route.request().postDataJSON() as Record<string, unknown>;
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						investigationId: THREAD_ID,
						jobId: "job-1",
						queued: true,
					}),
				});
			},
		);

		// Add a project: a real folder, no service.
		await page.goto("/projects");
		await page.getByTestId("add-project-source").fill(process.cwd());
		await page.getByTestId("add-project-submit").click();
		await expect(page.getByTestId("project-page")).toBeVisible();
		state.repositoryId = page.url().split("/projects/")[1] ?? null;
		await expect(page.getByTestId("make-service")).toContainText("service=");

		// Start a thread from the project's composer.
		await page.getByTestId("composer-input").fill("Rename retryOnce to retry");
		await page.getByTestId("composer-input").press("Enter");
		await expect(page).toHaveURL(new RegExp(`/threads/${THREAD_ID}`));
		expect(started).toMatchObject({
			subject: { kind: "project", repositoryId: state.repositoryId },
			text: "Rename retryOnce to retry",
		});
		await expect(page.getByTestId("thread-title")).toHaveText(
			"Rename retryOnce to retry",
		);
		await expect(page.getByTestId("composer-branch")).toHaveText(
			"prismalens/shop-f1111111",
		);

		// The agent edits a file, then asks to run a command.
		const ev = eventFactory("main");
		const edit = ev.agentStep("edit", "Renamed retryOnce in src/pay/retry.ts");
		const ask: CanonicalEvent = {
			kind: "permission_ask",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 1,
			ts: new Date().toISOString(),
			label: null,
			askId: ASK_ID,
			title: "pnpm test src/pay",
			detail: "pnpm test src/pay",
			toolKind: "execute",
			expiresAt: new Date(Date.now() + 600_000).toISOString(),
		} as CanonicalEvent;
		state.events = [edit, ask];
		await deliver(page, edit);
		await deliver(page, ask);
		await expect(page.getByText("Renamed retryOnce")).toBeVisible();

		// Approve.
		let answered: Record<string, unknown> | null = null;
		await page.route(
			(url) =>
				url.pathname === `/api/investigations/${THREAD_ID}/asks/${ASK_ID}`,
			async (route) => {
				answered = route.request().postDataJSON() as Record<string, unknown>;
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ outcome: "approved" }),
				});
			},
		);
		await page.getByTestId("ask-approve").click();
		await expect.poll(() => answered).toMatchObject({ decision: "approve" });

		// Stop.
		await page.route(
			(url) => url.pathname === `/api/investigations/${THREAD_ID}/cancel`,
			async (route) => {
				state.status = "cancelled";
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ id: THREAD_ID, status: "cancelled" }),
				});
			},
		);
		await page.getByTestId("composer-stop").click();

		// Reload: the thread is stopped, and what the agent did is still there.
		await page.reload();
		await expect(page.getByTestId("thread-state")).toHaveText("Stopped");
		await expect(page.getByText("Renamed retryOnce")).toBeVisible();

		// Resume: the follow-up goes to the same run, so the same workspace.
		let resumed: Record<string, unknown> | null = null;
		await page.route(
			(url) => url.pathname === `/api/investigations/${THREAD_ID}/messages`,
			async (route) => {
				resumed = route.request().postDataJSON() as Record<string, unknown>;
				state.status = "running";
				await route.fulfill({
					status: 202,
					contentType: "application/json",
					body: JSON.stringify({ state: "resumed" }),
				});
			},
		);
		await page.getByTestId("composer-input").fill("Now run the tests");
		await page.getByTestId("composer-input").press("Enter");
		await expect
			.poll(() => resumed)
			.toMatchObject({
				text: "Now run the tests",
				kind: "chat",
			});
		await expect(page.getByTestId("thread-state")).toHaveText("Working");
		await expect(page.getByTestId("composer-branch")).toHaveText(
			"prismalens/shop-f1111111",
		);
	});
});
