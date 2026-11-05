// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The thread list and New thread (#1020): the three journeys that must pass
 * before the old entry points go.
 */
import { expect, type Page, test } from "@playwright/test";
import { hideQueryDevtools } from "./live-stream-fixtures";

const THREAD_ID = "f5555555-5555-4555-8555-555555555555";
const RUN_ID = "f6666666-6666-4666-8666-666666666666";

async function addProject(page: Page): Promise<string> {
	await page.goto("/projects");
	await page.getByTestId("add-project-source").fill(process.cwd());
	await page.getByTestId("add-project-submit").click();
	await expect(page.getByTestId("project-page")).toBeVisible();
	return page.url().split("/projects/")[1] ?? "";
}

/** Answers POST /threads and records what the page sent. */
async function captureStart(page: Page): Promise<Record<string, unknown>[]> {
	const started: Record<string, unknown>[] = [];
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
					jobId: "job-list-1",
					queued: true,
				}),
			});
		},
	);
	return started;
}

const threadRow = (over: Record<string, unknown> = {}) => ({
	id: RUN_ID,
	incidentId: null,
	serviceId: null,
	scheduleId: null,
	repositoryId: null,
	subject: "none",
	status: "completed",
	kind: "chat",
	title: "Why does checkout cache miss",
	accessLevel: null,
	harness: null,
	model: null,
	effort: null,
	startedAt: null,
	completedAt: new Date().toISOString(),
	summary: null,
	rootCause: null,
	rootCauseCategory: null,
	error: null,
	awaitingApprovalAt: null,
	origin: "local",
	schemaVersion: 1,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	section: "needs",
	lastActivityAt: new Date().toISOString(),
	lastVisitedAt: null,
	settledAt: null,
	unseen: true,
	latestText: "It misses after the nightly flush",
	projectName: null,
	serviceName: null,
	...over,
});

test.describe("#1020 — thread list and New thread", () => {
	test.beforeEach(({ page }) => hideQueryDevtools(page));

	test("a. New thread on a project starts it there and opens its page", async ({
		page,
	}) => {
		const started = await captureStart(page);
		const projectId = await addProject(page);
		await page.getByTestId("sidebar-new-thread").click();
		await expect(page.getByTestId("new-thread-page")).toBeVisible({
			timeout: 15_000,
		});
		await page.getByTestId("composer-subject").click();
		await page.getByTestId(`subject-project-${projectId}`).click();
		await page.getByTestId("composer-input").fill("Tidy the retry helper");
		await page.getByTestId("composer-input").press("Enter");
		await expect(page).toHaveURL(new RegExp(`/threads/${THREAD_ID}`));
		expect(started[0]).toMatchObject({
			subject: { kind: "project", repositoryId: projectId },
			text: "Tidy the retry helper",
		});
	});

	test("b. New thread with Incident on creates the incident and investigates the text", async ({
		page,
	}) => {
		let investigated: Record<string, unknown> | null = null;
		await page.route(
			(url) => /\/api\/incidents\/[^/]+\/investigate$/.test(url.pathname),
			async (route) => {
				investigated = route.request().postDataJSON() as Record<
					string,
					unknown
				>;
				const incidentId = route.request().url().split("/")[5] ?? "";
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						incidentId,
						investigationId: RUN_ID,
						jobId: "job-inc-1",
						queued: true,
					}),
				});
			},
		);
		await page.goto("/threads/new?incident=true");
		await expect(page.getByTestId("new-thread-page")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("composer-incident")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await page.getByTestId("composer-severity").click();
		await page.getByTestId("severity-critical").click();
		await page
			.getByTestId("composer-input")
			.fill("Checkout returns 502 since noon\nSeen on every region");
		await page.getByTestId("composer-input").press("Enter");
		await expect(page).toHaveURL(
			new RegExp(`/incidents/[^/]+/conversation\\?investigation=${RUN_ID}`),
		);
		expect(investigated).toMatchObject({
			brief: "Checkout returns 502 since noon\nSeen on every region",
		});
		const incidentId = page.url().split("/incidents/")[1]?.split("/")[0];
		const incident = await page.request.get(`/api/incidents/${incidentId}`);
		expect(await incident.json()).toMatchObject({
			title: "Checkout returns 502 since noon",
			severity: "critical",
		});
	});

	test("c. a thread that needs you settles from its row, and Undo brings it back", async ({
		page,
	}) => {
		let settledAt: string | null = null;
		const settles: unknown[] = [];
		await page.route(
			(url) => url.pathname === "/api/threads/feed",
			async (route) => {
				const settled = settledAt !== null;
				const row = threadRow(
					settled
						? { section: "settled", unseen: false, settledAt }
						: { section: "needs" },
				);
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						units: [
							{
								section: row.section,
								incident: null,
								threads: [row],
							},
						],
						nextCursor: null,
						counts: {
							needs: settled ? 0 : 1,
							active: 0,
							settled: settled ? 1 : 0,
						},
					}),
				});
			},
		);
		await page.route(
			(url) => url.pathname === `/api/threads/${RUN_ID}/settle`,
			async (route) => {
				const body = route.request().postDataJSON() as { settled: boolean };
				settles.push(body);
				settledAt = body.settled ? new Date().toISOString() : null;
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ ids: [RUN_ID] }),
				});
			},
		);

		await page.goto("/incidents");
		const needs = page.getByTestId("threads-needs");
		await expect(needs.getByTestId("thread-row")).toHaveAttribute(
			"data-state",
			"new",
		);
		await expect(needs.getByTestId("thread-row-line")).toHaveText(
			"Answer: It misses after the nightly flush",
		);
		await needs.getByTestId("thread-row-wrap").hover();
		await needs.getByTestId("thread-settle").click();
		await expect(page.getByTestId("threads-needs")).toHaveCount(0);
		await expect(page.getByTestId("settle-undo-line")).toContainText(
			"Settled Why does checkout cache miss",
		);
		await expect(page.getByTestId("threads-settled-toggle")).toContainText("1");
		await page.getByTestId("settle-undo").click();
		await expect(
			page.getByTestId("threads-needs").getByTestId("thread-row"),
		).toBeVisible();
		await expect(page.getByTestId("settle-undo-line")).toHaveCount(0);
		expect(settles).toEqual([{ settled: true }, { settled: false }]);
	});

	test("d. Search finds a thread and places by name", async ({ page }) => {
		await page.route(
			(url) => url.pathname === "/api/threads/feed",
			async (route) => {
				const search = new URL(route.request().url()).searchParams.get(
					"search",
				);
				const rows =
					search === "cache" ? [threadRow({ section: "active" })] : [];
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						units: rows.map((r) => ({
							section: "active",
							incident: null,
							threads: [r],
						})),
						nextCursor: null,
						counts: { needs: 0, active: rows.length, settled: 0 },
					}),
				});
			},
		);
		await page.goto("/incidents");
		await expect(page.getByTestId("sidebar-search")).toBeVisible();
		await page.keyboard.press("Control+k");
		await expect(page.getByTestId("thread-search")).toBeVisible();
		await page.getByTestId("thread-search-input").fill("cache");
		await expect(page.getByTestId("thread-search-result")).toHaveText(
			/Why does checkout cache miss/,
		);
		await page.getByTestId("thread-search-input").fill("serv");
		await expect(page.getByTestId("thread-search-place")).toHaveText(
			"Services",
		);
		await page.getByTestId("thread-search-place").click();
		await expect(page).toHaveURL(/\/services/);
	});
});
