// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Make it a service and Link to a project (#1020): both name a service and show the
 * read-only `service=<name>` rule alerts map by.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createIncidentByHand } from "./by-hand";

/** A folder no other journey adds: a folder inside this checkout resolves to the same project. */
const ownFolder = () => {
	const dir = mkdtempSync(join(tmpdir(), "pl-e2e-project-"));
	// A git folder: a plain one is a Folder project, which cannot be a service (#1020).
	execFileSync("git", ["init", "-q"], { cwd: dir });
	return dir;
};

const ALERT_ID = "a1020000-0000-4000-8000-000000000001";

test.describe("#1020 — services for projects", () => {
	test("an unmapped alert links to a project, making the service its label names", async ({
		page,
	}) => {
		const name = `cart-api-${Date.now()}`;
		await page.goto("/projects?add=1");
		await page.getByTestId("add-project-source").fill(ownFolder());
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

	test("a project the search no longer shows is not linkable", async ({
		page,
	}) => {
		const now = new Date().toISOString();
		const projects = [
			{ id: "b1020000-0000-4000-8000-000000000001", fullName: "org/alpha" },
			{ id: "b1020000-0000-4000-8000-000000000002", fullName: "org/beta" },
		];
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
								dedupKey: "link-project-stale",
								title: "Cart errors",
								severity: "high",
								status: "triggered",
								incidentId: null,
								serviceId: null,
								service: null,
								labels: { service: "cart-api" },
								triggeredAt: now,
								occurrenceCount: 1,
								lastOccurrence: now,
								createdAt: now,
								updatedAt: now,
							},
						],
						pagination: { total: 1, limit: 100, offset: 0, hasMore: false },
					}),
				});
			},
		);
		// A total beyond the page is what shows the search box.
		await page.route(
			(url) => url.pathname === "/api/repositories",
			async (route) => {
				const search = new URL(route.request().url()).searchParams.get(
					"search",
				);
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						data: projects.filter(
							(p) => !search || p.fullName.includes(search),
						),
						total: 101,
					}),
				});
			},
		);

		await page.goto("/alerts?tab=unmapped");
		await page
			.getByTestId("alert-row-link")
			.filter({ hasText: "Cart errors" })
			.hover();
		await page.getByTestId("alert-link-project").click();
		const dialog = page.getByTestId("link-project-dialog");
		const submit = dialog.getByTestId("link-project-submit");
		await dialog.getByTestId("link-project-pick").click();
		await page.getByTestId(`link-project-${projects[0]?.id}`).click();
		await expect(submit).toBeEnabled();

		await dialog.getByTestId("link-project-find").fill("beta");
		await expect(submit).toBeDisabled();
		await expect(dialog.getByTestId("link-project-pick")).toHaveText("Project");
	});

	test("a blank incident says What do you know so far?, links a service and keeps the composer", async ({
		page,
	}) => {
		await createIncidentByHand(page, `Blank incident ${Date.now()}`);
		const blank = page.getByTestId("incident-blank");
		await expect(blank).toContainText("What do you know so far?");
		await expect(blank.getByTestId("overview-composer")).toBeVisible();
		await expect(page.getByTestId("impact-card")).toHaveCount(0);
		await expect(page.getByTestId("why-card")).toHaveCount(0);
		await blank.getByTestId("incident-link-service").click();
		await page.getByRole("option").first().click();
		await expect(blank.getByTestId("incident-link-service")).toHaveCount(0);
	});
});
