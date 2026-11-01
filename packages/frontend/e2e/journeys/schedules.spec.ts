// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

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
});
