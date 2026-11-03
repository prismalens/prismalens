// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Make it a service and Link to a project (#1020): both name a service and show the
 * read-only `service=<name>` rule alerts map by.
 */
import { expect, test } from "@playwright/test";

const ALERT_ID = "a1020000-0000-4000-8000-000000000001";

test.describe("#1020 — services for projects", () => {
	test("an unmapped alert links to a project, making the service its label names", async ({
		page,
	}) => {
		const name = `cart-api-${Date.now()}`;
		await page.goto("/projects");
		await page.getByTestId("add-project-source").fill(process.cwd());
		await page.getByTestId("add-project-submit").click();
		await expect(page.getByTestId("project-page")).toBeVisible();
		const repo = { id: page.url().split("/projects/")[1] ?? "" };
		await page.route(
			(url) =>
				url.pathname === "/api/alerts" &&
				url.searchParams.get("unassigned") === "true",
			async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						data: [
							{
								id: ALERT_ID,
								dedupKey: "link-project",
								title: "Cart errors",
								severity: "high",
								status: "triggered",
								incidentId: null,
								serviceId: null,
								service: null,
								labels: { service: name },
								triggeredAt: new Date().toISOString(),
								occurrenceCount: 1,
								lastOccurrence: new Date().toISOString(),
								createdAt: new Date().toISOString(),
								updatedAt: new Date().toISOString(),
							},
						],
						pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
					}),
				});
			},
		);

		await page.goto("/alerts?tab=unmapped");
		const row = page
			.getByTestId("alert-row-link")
			.filter({ hasText: "Cart errors" });
		await row.hover();
		await page.getByTestId("alert-link-project").click();
		const dialog = page.getByTestId("link-project-dialog");
		await expect(dialog.getByTestId("link-project-name")).toHaveValue(name);
		await expect(dialog.getByTestId("link-project-rule")).toHaveText(
			`service=${name}`,
		);
		await dialog.getByTestId("link-project-pick").click();
		await page.getByTestId(`link-project-${repo.id}`).click();
		await dialog.getByTestId("link-project-submit").click();
		await expect(dialog).toBeHidden();

		const services = (await (
			await page.request.get("/api/services?limit=100")
		).json()) as {
			data: { id: string; name: string }[];
		};
		const made = services.data.find((s) => s.name === name);
		expect(made).toBeDefined();

		await page.goto(`/projects/${repo.id}`);
		await expect(page.getByTestId("project-service-rule")).toHaveText(
			`service=${name}`,
		);

		await page.request.delete(`/api/services/${made?.id}`);
	});
});
