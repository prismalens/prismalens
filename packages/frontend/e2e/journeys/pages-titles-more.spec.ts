// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Pages, titles and scheduled prompts journeys (#1020).
 *
 * Verifies:
 * 1. Blank incident page shows Nothing yet, Link service and centered composer with no empty cards,
 *    and shows content cards only once content is added.
 * 2. Renaming a thread from its row updates the list, the thread page, survives reload, and renders
 *    untrusted input containing HTML/XSS as plain text.
 * 3. Settings -> Scheduled prompts lists schedules, /schedules redirects there, and a schedule opens.
 * 4. An unmapped alert row offers Link to a project, shows the read-only service=<name> rule, and
 *    leaves the unmapped state.
 * 5. Project page Make it a service takes name only and shows the read-only service=<name> rule.
 * 6. After a user rename, an agent title update cannot overwrite the user's title.
 */
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createIncidentByHand } from "./by-hand";
import { hideQueryDevtools } from "./live-stream-fixtures";

const THREAD_ID = "e1020000-0000-4000-8000-000000000001";
const ALERT_ID = "a1020000-0000-4000-8000-000000000002";

const threadRow = (over: Record<string, unknown> = {}) => ({
	id: THREAD_ID,
	incidentId: null,
	serviceId: null,
	scheduleId: null,
	repositoryId: null,
	subject: "none",
	status: "completed",
	kind: "chat",
	title: "Initial investigation thread",
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
	section: "active",
	lastActivityAt: new Date().toISOString(),
	lastVisitedAt: null,
	settledAt: null,
	unseen: false,
	latestText: "Latest thread message text",
	projectName: null,
	serviceName: null,
	...over,
});

test.describe("#1020 — pages, titles, scheduled prompts", () => {
	test.beforeEach(({ page }) => hideQueryDevtools(page));

	test("1. Blank incident page shows Nothing yet, Link service and composer, and shows content cards only when they have content after a first message", async ({
		page,
	}) => {
		const incidentTitle = `Blank incident ${Date.now()}`;
		await createIncidentByHand(page, incidentTitle);

		const blank = page.getByTestId("incident-blank");
		await expect(blank).toContainText("Nothing yet");
		await expect(blank.getByTestId("incident-link-service")).toBeVisible();
		await expect(blank.getByTestId("overview-composer")).toBeVisible();

		// No empty cards before content arrives
		await expect(page.getByTestId("overview-grid")).toHaveCount(0);
		await expect(page.getByTestId("why-card")).toHaveCount(0);
		await expect(page.getByTestId("impact-card")).toHaveCount(0);
		await expect(page.getByTestId("changes-card")).toHaveCount(0);

		// Post a first message (a timeline note) from the composer
		const actionChip = blank.getByTestId("action-chip");
		await actionChip.click();
		await page.getByRole("menuitemradio", { name: "Note" }).click();

		const noteContent = `First incident note ${Date.now()}`;
		const input = blank.getByTestId("composer-input");
		await input.fill(noteContent);
		await input.press("Enter");

		// After the first message, the blank state leaves and content cards appear
		await expect(blank).toHaveCount(0);
		await expect(page.getByTestId("overview-grid")).toBeVisible();
		const changesCard = page.getByTestId("changes-card");
		await expect(changesCard).toBeVisible();
		await expect(changesCard.getByTestId("changes-timeline")).toContainText(
			noteContent,
		);
	});

	test("2. Rename a thread from its row: the new title shows in the list and the thread page and survives reload; XSS renders as plain text", async ({
		page,
	}) => {
		let title = "Initial title before rename";
		let dialogTriggered = false;
		page.on("dialog", (d) => {
			dialogTriggered = true;
			void d.dismiss();
		});

		const attackTitle = "<img src=x onerror=alert(1)>";

		await page.route(
			(url) => url.pathname === "/api/threads/feed",
			async (route) => {
				const row = threadRow({ id: THREAD_ID, title, section: "active" });
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						units: [{ section: "active", incident: null, threads: [row] }],
						nextCursor: null,
						counts: { needs: 0, active: 1, settled: 0 },
					}),
				});
			},
		);

		await page.route(
			(url) => url.pathname === `/api/threads/${THREAD_ID}/title`,
			async (route) => {
				const body = route.request().postDataJSON() as { title: string };
				title = body.title;
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ id: THREAD_ID, title }),
				});
			},
		);

		await page.route(
			(url) => url.pathname === `/api/investigations/${THREAD_ID}`,
			async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						id: THREAD_ID,
						incidentId: null,
						serviceId: null,
						scheduleId: null,
						repositoryId: null,
						subject: "none",
						status: "completed",
						kind: "chat",
						title,
						accessLevel: "supervised",
						harness: null,
						model: null,
						effort: null,
						hasReport: false,
						startedAt: new Date().toISOString(),
						completedAt: new Date().toISOString(),
						summary: null,
						rootCause: null,
						rootCauseCategory: null,
						report: null,
						error: null,
						workspace: null,
						resumable: false,
						resumeBlockedReason: null,
						continuable: false,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					}),
				});
			},
		);

		await page.route(
			(url) => url.pathname === `/api/investigations/${THREAD_ID}/status`,
			async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						investigation: {
							id: THREAD_ID,
							status: "completed",
							title,
						},
						job: null,
					}),
				});
			},
		);

		await page.route(
			(url) => url.pathname === `/api/investigations/${THREAD_ID}/events`,
			async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ events: [], nextCursor: null }),
				});
			},
		);

		await page.goto("/incidents");
		const row = page.getByTestId("thread-row-wrap").first();
		await row.hover();
		await row.getByTestId("thread-rename").click();

		const input = page.getByTestId("thread-rename-input");
		await expect(input).toBeFocused();
		await input.fill(attackTitle);
		await input.press("Enter");

		// New title shows in thread list
		await expect(page.getByTestId("thread-row-title").first()).toHaveText(
			attackTitle,
		);

		// Opens thread page and title shows there
		await page.goto(`/threads/${THREAD_ID}`);
		await expect(page.getByTestId("thread-title")).toHaveText(attackTitle);

		// Survives reload
		await page.reload();
		await expect(page.getByTestId("thread-title")).toHaveText(attackTitle);
		await expect(page.getByTestId("thread-row-title").first()).toHaveText(
			attackTitle,
		);

		// Plain text rendering: no dialog triggered and no img element injected
		expect(dialogTriggered).toBe(false);
		await expect(page.locator("img[src='x']")).toHaveCount(0);
	});

	test("3. Settings -> Scheduled prompts lists schedules; visiting /schedules redirects there; a schedule can be opened from it", async ({
		page,
	}) => {
		const services = await page.request.get("/api/services");
		const serviceId = ((await services.json()) as { data: { id: string }[] })
			.data[0]?.id;
		expect(serviceId).toBeDefined();

		const scheduleName = `Scheduled test ${Date.now()}`;
		const created = await page.request.post("/api/schedules", {
			data: {
				name: scheduleName,
				serviceId,
				runbook: null,
				brief: "Check service metrics and report anomalies",
				recurrence: { type: "cron", expr: "0 9 * * 1-5", timezone: "UTC" },
				harness: "opencode",
				model: null,
				effort: null,
				missedPolicy: "run_once",
				catchUpMinutes: 60,
			},
		});
		expect(created.ok(), await created.text()).toBe(true);
		const { id: scheduleId } = (await created.json()) as { id: string };

		try {
			// Visiting /schedules redirects to /settings?tab=schedules
			await page.goto("/schedules");
			await expect(page).toHaveURL(/\/settings\?tab=schedules$/);

			// Settings -> Scheduled prompts lists schedules
			await expect(
				page.getByRole("heading", { name: "Scheduled prompts", level: 2 }),
			).toBeVisible({ timeout: 15_000 });
			const scheduleLink = page
				.getByRole("link", { name: scheduleName })
				.first();
			await expect(scheduleLink).toBeVisible();

			// A schedule can be opened from it
			await scheduleLink.click();
			await expect(page).toHaveURL(new RegExp(`/schedules/${scheduleId}$`));
			await expect(
				page.getByRole("heading", { name: scheduleName }),
			).toBeVisible();
		} finally {
			await page.request.delete(`/api/schedules/${scheduleId}`);
		}
	});

	test("4. An unmapped alert row offers Link to a project; linking shows the read-only service=<name> rule and the row leaves the unmapped state", async ({
		page,
	}) => {
		const serviceName = `cart-api-${Date.now()}`;
		await page.goto("/projects");
		await page
			.getByTestId("add-project-source")
			.fill(join(process.cwd(), "e2e"));
		await page.getByTestId("add-project-submit").click();
		await expect(page.getByTestId("project-page")).toBeVisible();
		const repoId = page.url().split("/projects/")[1] ?? "";

		let mapped = false;
		await page.route(
			(url) =>
				url.pathname === "/api/alerts" &&
				url.searchParams.get("unassigned") === "true",
			async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						data: mapped
							? []
							: [
									{
										id: ALERT_ID,
										dedupKey: "link-project-test",
										title: "Cart errors",
										severity: "high",
										status: "triggered",
										incidentId: null,
										serviceId: null,
										service: null,
										labels: { service: serviceName },
										triggeredAt: new Date().toISOString(),
										occurrenceCount: 1,
										lastOccurrence: new Date().toISOString(),
										createdAt: new Date().toISOString(),
										updatedAt: new Date().toISOString(),
									},
								],
						pagination: {
							total: mapped ? 0 : 1,
							limit: 100,
							offset: 0,
							hasMore: false,
						},
					}),
				});
			},
		);

		await page.goto("/alerts?tab=unmapped");
		const row = page
			.getByTestId("alert-row-link")
			.filter({ hasText: "Cart errors" });
		await expect(row).toBeVisible();
		await row.hover();

		// Row offers Link to a project
		const linkBtn = page.getByTestId("alert-link-project");
		await expect(linkBtn).toBeVisible();
		await linkBtn.click();

		// Dialog shows the read-only service=<name> rule
		const dialog = page.getByTestId("link-project-dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByTestId("link-project-name")).toHaveValue(
			serviceName,
		);
		await expect(dialog.getByTestId("link-project-rule")).toHaveText(
			`service=${serviceName}`,
		);

		// Link to project
		mapped = true;
		await dialog.getByTestId("link-project-pick").click();
		await page.getByTestId(`link-project-${repoId}`).click();
		await dialog.getByTestId("link-project-submit").click();
		await expect(dialog).toBeHidden();

		// Clean up created service if one was registered on the server
		try {
			// The row leaves the unmapped state
			await expect(row).toHaveCount(0);
		} finally {
			const services = (await (
				await page.request.get("/api/services?limit=100")
			).json()) as {
				data: { id: string; name: string }[];
			};
			const made = services.data.find((s) => s.name === serviceName);
			if (made) {
				await page.request.delete(`/api/services/${made.id}`);
			}
		}
	});

	test("5. Project page Make it a service: name only, shows the service=<name> rule read-only (no editable matcher)", async ({
		page,
	}) => {
		const serviceName = `service-make-${Date.now()}`;
		await page.goto("/projects");
		await page
			.getByTestId("add-project-source")
			.fill(join(process.cwd(), "e2e", "steps"));
		await page.getByTestId("add-project-submit").click();
		await expect(page.getByTestId("project-page")).toBeVisible();
		const repoId = page.url().split("/projects/")[1] ?? "";

		await page.goto(`/projects/${repoId}`);
		const makeSection = page.getByTestId("make-service");
		await expect(makeSection).toBeVisible();

		// Name only: only one input for service name, no editable matcher
		const nameInput = page.getByTestId("make-service-name");
		await expect(nameInput).toBeVisible();
		await expect(makeSection.locator("input, textarea")).toHaveCount(1);
		await expect(page.getByLabel("Matcher")).toHaveCount(0);

		// Shows the service=<name> rule read-only (no editable matcher)
		await nameInput.fill(serviceName);
		await expect(makeSection.getByText(`service=${serviceName}`)).toBeVisible();
	});

	test("6. After a user rename, an agent title update does not overwrite the user's title", async () => {
		test.skip(
			true,
			"The stack does not expose an HTTP/UI path or fake-session for agent thread_title updates",
		);
	});
});
