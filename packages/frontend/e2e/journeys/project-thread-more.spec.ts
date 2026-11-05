// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import type { CanonicalEvent } from "@prismalens/contracts";
import {
	deliver,
	eventFactory,
	hideQueryDevtools,
	installStreamDouble,
} from "./live-stream-fixtures";

const THREAD_ID = "f3333333-3333-4333-8333-333333333333";
const OTHER_THREAD_ID = "f4444444-4444-4444-8444-444444444444";
const CWD = "/tmp/worktrees/pl-f3333333";

interface ThreadState {
	status: string;
	repositoryId: string | null;
	title?: string;
	events: CanonicalEvent[];
}

/** The thread's run as the API would serve it, from the state the test holds. */
async function serveThread(
	page: Page,
	state: ThreadState,
	threadId: string = THREAD_ID,
): Promise<void> {
	const row = () => ({
		id: threadId,
		incidentId: null,
		serviceId: null,
		scheduleId: null,
		repositoryId: state.repositoryId,
		subject: "project",
		status: state.status,
		kind: "chat",
		title: state.title ?? "Thread test title",
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
					branch: "prismalens/shop-f3333333",
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
		(url) => url.pathname === `/api/investigations/${threadId}`,
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(row()),
			}),
	);
	await page.route(
		(url) => url.pathname === `/api/investigations/${threadId}/status`,
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ investigation: row(), job: null }),
			}),
	);
	await page.route(
		(url) => url.pathname === `/api/investigations/${threadId}/events`,
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ events: state.events, nextCursor: null }),
			}),
	);
}

test.describe("#1020 — project thread journeys", () => {
	test.beforeEach(({ page }) => hideQueryDevtools(page));

	test("1. add a project from the Projects page with no service; it appears in the list and its page opens", async ({
		page,
	}) => {
		// Add a project from the Projects page: a real folder, no service
		await page.goto("/projects");
		await expect(page.getByTestId("projects-page")).toBeVisible();
		await page.getByTestId("add-project-source").fill(process.cwd());
		await page.getByTestId("add-project-submit").click();

		// Its page opens
		await expect(page.getByTestId("project-page")).toBeVisible();
		const projectName =
			(await page.getByTestId("project-name").textContent()) ?? "";
		expect(projectName).not.toBe("");

		// No service linked: MakeService form is shown with service=<projectName>
		await expect(page.getByTestId("make-service")).toBeVisible();
		await expect(page.getByTestId("make-service")).toContainText("service=");

		// It appears in the list
		await page.getByRole("link", { name: "Back to projects" }).click();
		await expect(page.getByTestId("projects-page")).toBeVisible();
		const row = page
			.getByTestId("project-row")
			.filter({ hasText: projectName });
		await expect(row).toBeVisible();

		// Its page opens when clicked from the list
		await row.click();
		await expect(page.getByTestId("project-page")).toBeVisible();
		await expect(page.getByTestId("project-name")).toHaveText(projectName);
	});

	test("2. start a thread on a project, reload the page, the thread page still loads with the same transcript", async ({
		page,
	}) => {
		const state: ThreadState = {
			status: "running",
			repositoryId: null,
			title: "Analyze database indexes",
			events: [],
		};
		await installStreamDouble(page);
		await serveThread(page, state, THREAD_ID);

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
						jobId: "job-more-2",
						queued: true,
					}),
				});
			},
		);

		await page.goto("/projects");
		await page.getByTestId("add-project-source").fill(process.cwd());
		await page.getByTestId("add-project-submit").click();
		await expect(page.getByTestId("project-page")).toBeVisible();
		state.repositoryId = page.url().split("/projects/")[1] ?? null;

		// Start a thread from the project's composer
		await page.getByTestId("composer-input").fill("Analyze database indexes");
		await page.getByTestId("composer-input").press("Enter");
		await expect(page).toHaveURL(new RegExp(`/threads/${THREAD_ID}`));
		expect(started).toMatchObject({
			subject: { kind: "project", repositoryId: state.repositoryId },
			text: "Analyze database indexes",
		});
		await expect(page.getByTestId("thread-title")).toHaveText(
			"Analyze database indexes",
		);

		// The agent produces transcript events
		const ev = eventFactory("main");
		const step1 = ev.agentStep(
			"investigate",
			"Checking index efficiency on orders table",
		);
		const step2 = ev.agentStep(
			"summary",
			"Analysis complete: added index on orders(created_at)",
		);
		state.events = [step1, step2];
		await deliver(page, step1);
		await deliver(page, step2);

		await expect(
			page.getByText("Checking index efficiency on orders table"),
		).toBeVisible();
		await expect(
			page.getByText("Analysis complete: added index on orders(created_at)"),
		).toBeVisible();

		// Reload the page: the thread page still loads with the same transcript
		await page.reload();
		await expect(page.getByTestId("thread-page")).toBeVisible();
		await expect(page.getByTestId("thread-title")).toHaveText(
			"Analyze database indexes",
		);
		await expect(
			page.getByText("Checking index efficiency on orders table"),
		).toBeVisible();
		await expect(
			page.getByText("Analysis complete: added index on orders(created_at)"),
		).toBeVisible();
	});

	test("3. start a thread with no subject (none) and one on a service; both open on the standalone thread page", async ({
		page,
	}) => {
		const state: ThreadState = {
			status: "running",
			repositoryId: null,
			title: "Thread with no subject",
			events: [],
		};
		await installStreamDouble(page);
		await serveThread(page, state, THREAD_ID);
		const started: Array<Record<string, unknown>> = [];
		await page.route(
			(url) => url.pathname === "/api/threads",
			async (route) => {
				if (route.request().method() !== "POST") return route.fallback();
				started.push(route.request().postDataJSON() as Record<string, unknown>);
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						investigationId: THREAD_ID,
						jobId: "job-more-3",
						queued: true,
					}),
				});
			},
		);

		// No subject: New thread starts on "No project"
		await page.goto("/threads/new");
		await expect(page.getByTestId("new-thread-page")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("composer-subject")).toHaveText("No project");
		await page.getByTestId("composer-input").fill("Thread with no subject");
		await page.getByTestId("composer-input").press("Enter");
		await expect(page).toHaveURL(new RegExp(`/threads/${THREAD_ID}`));
		await expect(page.getByTestId("thread-page")).toBeVisible();
		expect(started[0]).toMatchObject({ subject: { kind: "none" } });

		// A service: picked in the same subject picker
		const name = `svc-${Date.now()}`;
		const created = await page.request.post("/api/services", {
			data: { name },
		});
		expect(created.ok()).toBe(true);
		const serviceId = ((await created.json()) as { id: string }).id;
		await page.goto("/threads/new");
		await expect(page.getByTestId("new-thread-page")).toBeVisible({
			timeout: 15_000,
		});
		await page.getByTestId("composer-subject").click();
		await page.getByTestId(`subject-service-${serviceId}`).click();
		await page.getByTestId("composer-input").fill("Thread on a service");
		await page.getByTestId("composer-input").press("Enter");
		await expect(page).toHaveURL(new RegExp(`/threads/${THREAD_ID}`));
		await expect(page.getByTestId("thread-page")).toBeVisible();
		expect(started[1]).toMatchObject({
			subject: { kind: "service", serviceId },
			text: "Thread on a service",
		});
	});

	test("4. an attachment added to a thread draft is not visible from a different thread", async ({
		page,
	}) => {
		const stateOne: ThreadState = {
			status: "running",
			repositoryId: null,
			title: "Thread Alpha",
			events: [],
		};
		const stateTwo: ThreadState = {
			status: "running",
			repositoryId: null,
			title: "Thread Beta",
			events: [],
		};

		await installStreamDouble(page);
		await serveThread(page, stateOne, THREAD_ID);
		await serveThread(page, stateTwo, OTHER_THREAD_ID);

		// Navigate to thread one
		await page.goto(`/threads/${THREAD_ID}`);
		await expect(page.getByTestId("thread-page")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("composer-file")).toHaveCount(0);

		// Add an attachment to the thread draft in composer
		await page.getByTestId("composer-file-input").setInputFiles({
			name: "thread-one-draft.txt",
			mimeType: "text/plain",
			buffer: Buffer.from("Draft content for thread one only"),
		});

		// The draft attachment is visible in thread one's composer
		await expect(page.getByTestId("composer-file")).toBeVisible();
		await expect(page.getByTestId("composer-file")).toContainText(
			"thread-one-draft.txt",
		);

		// Navigate to a different thread (thread two)
		await page.goto(`/threads/${OTHER_THREAD_ID}`);
		await expect(page.getByTestId("thread-page")).toBeVisible();

		// The attachment added to thread one draft is NOT visible from thread two
		await expect(page.getByTestId("composer-file")).toHaveCount(0);
		await expect(page.getByText("thread-one-draft.txt")).not.toBeVisible();
	});
});
