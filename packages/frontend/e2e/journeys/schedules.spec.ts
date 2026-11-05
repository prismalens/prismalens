// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

/** A workspace with no schedules of its own and no service, over the real API. */
async function emptyWorkspace(page: Page) {
	for (const [path, key] of [
		[/\/api\/schedules(\?.*)?$/, "schedules"],
		[/\/api\/services(\?.*)?$/, "data"],
	] as const)
		await page.route(path, async (route) => {
			if (route.request().method() !== "GET") return route.continue();
			const res = await route.fetch();
			const body = await res.json();
			body[key] = [];
			await route.fulfill({ response: res, json: body });
		});
}

/** #979 - Search opens the schedules list (#1020), and a schedule opens its history. */
test.describe("#979 - schedules", () => {
	test("Search opens the Schedules list, and a row opens that schedule's history", async ({
		page,
	}) => {
		const services = await page.request.get("/api/services");
		const serviceId = ((await services.json()) as { data: { id: string }[] })
			.data[0]?.id;
		expect(serviceId).toBeDefined();
		const name = `Journey check ${Date.now()}`;
		const created = await page.request.post("/api/schedules", {
			data: {
				name,
				serviceId,
				runbook: null,
				brief: "Check the service health",
				recurrence: { type: "cron", expr: "0 9 * * 1-5", timezone: "UTC" },
				harness: "opencode",
				model: null,
				effort: null,
				missedPolicy: "run_once",
				catchUpMinutes: 60,
			},
		});
		expect(created.ok(), await created.text()).toBe(true);
		const { id } = (await created.json()) as { id: string };

		await page.goto("/incidents");
		await page.getByTestId("sidebar").getByTestId("sidebar-search").click();
		await page
			.getByTestId("thread-search-place")
			.filter({ hasText: "Scheduled prompts" })
			.click();
		await expect(page).toHaveURL(/\/settings\?tab=schedules$/);
		await expect(
			page.getByRole("heading", { name: "Scheduled prompts", level: 2 }),
		).toBeVisible({ timeout: 15_000 });

		await page.getByRole("link", { name }).first().click();
		await expect(page).toHaveURL(new RegExp(`/schedules/${id}$`));
		await expect(page.getByRole("heading", { name })).toBeVisible();

		await page.request.delete(`/api/schedules/${id}`);
	});

	test("with no schedule of its own the page has one New schedule, and with no service a schedule is about no project", async ({
		page,
	}) => {
		await emptyWorkspace(page);
		await page.goto("/schedules");
		const empty = page.getByTestId("schedules-empty");
		await expect(empty).toHaveText(/No schedules yet/, { timeout: 15_000 });
		await expect(
			page.getByRole("button", { name: "New schedule" }),
		).toHaveCount(1);
		await expect(
			empty.locator("xpath=following-sibling::*[1]"),
		).toHaveAttribute("data-testid", "helper-thread");
		await expect(empty.locator("xpath=following-sibling::*[2]")).toContainText(
			"Built into PrismaLens",
		);

		await page.getByTestId("new-schedule").click();
		const dialog = page.getByTestId("schedule-dialog");
		await expect(dialog.getByTestId("schedule-subject")).toHaveText(
			"No project",
		);
		await expect(
			dialog.getByRole("button", { name: "Create schedule" }),
		).toBeDisabled();
		// A services read still in flight must not outlive the test's routes.
		await page.unrouteAll({ behavior: "ignoreErrors" });
	});

	test("a schedule is a saved composer: no project, Report off, Wait for me (#1020)", async ({
		page,
	}) => {
		await page.goto("/settings?tab=schedules");
		await page.getByTestId("new-schedule").click({ timeout: 15_000 });
		const dialog = page.getByTestId("schedule-dialog");
		const name = `Saved composer ${Date.now()}`;
		await dialog.getByLabel("Name").fill(name);
		const box = dialog.getByTestId("composer-input");
		await expect(dialog.getByTestId("composer-attach")).toHaveCount(0);
		await expect(
			box.locator("xpath=ancestor::form").getByTestId("access-chip"),
		).toBeVisible();
		await box.fill("Summarise what changed this week");
		await dialog.getByTestId("schedule-report").click();
		await expect(dialog.getByTestId("schedule-report")).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		await dialog.getByTestId("schedule-asks-wait").click();
		await dialog.getByRole("button", { name: "Create schedule" }).click();
		await expect(dialog).toBeHidden();

		const list = await (await page.request.get("/api/schedules")).json();
		const made = (
			list.schedules as Array<{
				id: string;
				name: string;
				subject: string;
				report: boolean;
				whenAsks: string;
				serviceId: string | null;
			}>
		).find((s) => s.name === name);
		expect(made).toMatchObject({
			subject: "none",
			report: false,
			whenAsks: "wait",
			serviceId: null,
		});
		await expect(page.getByText("No project").first()).toBeVisible();
		await page.request.delete(`/api/schedules/${made?.id}`);
	});
});
