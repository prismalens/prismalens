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

/** #979 - the Schedules door opens the list, and a schedule opens its history. */
test.describe("#979 - schedules", () => {
	test("the sidebar's Schedules door opens the list, and a row opens that schedule's history", async ({
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
		await page
			.getByTestId("sidebar")
			.getByRole("link", { name: "Schedules", exact: true })
			.click();
		await expect(page).toHaveURL(/\/schedules$/);
		await expect(page.getByRole("heading", { name: "Schedules" })).toBeVisible({
			timeout: 15_000,
		});

		await page.getByRole("link", { name }).first().click();
		await expect(page).toHaveURL(new RegExp(`/schedules/${id}$`));
		await expect(page.getByRole("heading", { name })).toBeVisible();

		await page.request.delete(`/api/schedules/${id}`);
	});

	test("with no schedule of its own the page has one New schedule, and with no service the dialog sends you to Services", async ({
		page,
	}) => {
		await emptyWorkspace(page);
		await page.goto("/schedules");
		const empty = page.getByTestId("schedules-empty");
		await expect(empty).toHaveText(/No schedules yet/, { timeout: 15_000 });
		await expect(
			page.getByRole("button", { name: "New schedule" }),
		).toHaveCount(1);
		await expect(empty.locator("xpath=following-sibling::*[1]")).toContainText(
			"Built into PrismaLens",
		);

		await page.getByTestId("new-schedule").click();
		const dialog = page.getByTestId("schedule-dialog");
		await expect(dialog.getByText("No services yet.")).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: "Create schedule" }),
		).toBeDisabled();
		await dialog.getByRole("link", { name: "Add a service" }).click();
		await expect(page).toHaveURL(/\/services\?/);
		await expect(
			page.getByRole("dialog").getByText("Add a service"),
		).toBeVisible();
	});
});
