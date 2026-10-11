// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import { setTheme } from "./live-stream-fixtures";

/**
 * #523 S2/final, #811 — the incident sidebar tree and keyboard surface.
 * Open incidents appear grouped by service in IncidentTree; closed ones are omitted.
 */
test.use({ viewport: { width: 1440, height: 900 } });

async function createIncident(page: Page, title: string): Promise<string> {
	const created = await page.request.post("/api/incidents", {
		data: { title },
	});
	expect(created.ok()).toBeTruthy();
	const incident: { id: string } = await created.json();
	return incident.id;
}

function headerHeading(page: Page) {
	return page
		.getByTestId("page-header")
		.getByRole("heading", { name: "Incidents", exact: true });
}

function treeRow(page: Page, id: string) {
	return page
		.getByTestId("tree-incident")
		.filter({ has: page.locator(`a[href*="${id}"]`) });
}

test.describe("#523 S2/final — the incidents queue and sidebar tree", () => {
	test("grouping and the keyboard surface", async ({ page }) => {
		const stamp = Date.now();
		const triggeredTitle = `Queue triggered ${stamp}`;
		const failedRunTitle = `Queue failed run ${stamp}`;
		const resolvedTitle = `Queue resolved ${stamp}`;
		const closedTitle = `Queue closed ${stamp}`;

		const closedId = await createIncident(page, closedTitle);
		await page.request.post(`/api/incidents/${closedId}/resolve`);
		await page.request.post(`/api/incidents/${closedId}/close`, {
			data: {},
		});

		const triggeredId = await createIncident(page, triggeredTitle);

		const failedRunId = await createIncident(page, failedRunTitle);
		await page.request.patch(`/api/incidents/${failedRunId}`, {
			data: { status: "investigating" },
		});

		const resolvedId = await createIncident(page, resolvedTitle);
		await page.request.post(`/api/incidents/${resolvedId}/resolve`);

		await page.goto("/incidents?view=analytics");
		await expect(headerHeading(page)).toBeVisible({ timeout: 15_000 });
		await setTheme(page, "light");

		const tree = page.getByTestId("incident-tree");
		await expect(tree).toBeVisible({ timeout: 15_000 });

		for (const more of await tree.getByTestId("tree-more").all()) {
			if (await more.isVisible()) await more.click();
		}

		const triggeredRow = treeRow(page, triggeredId);
		const failedRow = treeRow(page, failedRunId);
		const resolvedRow = treeRow(page, resolvedId);
		const closedRow = treeRow(page, closedId);
		await expect(triggeredRow).toBeVisible();
		await expect(failedRow).toBeVisible();
		await expect(resolvedRow).toBeVisible();
		await expect(closedRow).toHaveCount(0);

		// `?` opens the shortcut sheet.
		await page.keyboard.press("?");
		await expect(page.getByTestId("shortcut-sheet")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("shortcut-sheet")).toHaveCount(0);

		// `[` folds the sidebar to its 56-px icon rail and back (study-v3 §2).
		const sidebar = page.getByTestId("sidebar");
		await expect(sidebar).toBeVisible();
		const width = async () => (await sidebar.boundingBox())?.width;
		expect(await width()).toBe(240);
		await page.keyboard.press("[");
		await expect.poll(width).toBe(56);
		await expect(sidebar.getByTestId("nav-alerts")).toBeVisible();
		await page.keyboard.press("[");
		await expect.poll(width).toBe(240);

		// `g` then `a` goes to the alerts front door.
		await page.keyboard.press("g");
		await page.keyboard.press("a");
		await expect(page).toHaveURL(/\/alerts(\/|\?|$)/);

		// Clicking a row in the tree navigates to the incident overview
		await page.goto("/incidents?view=analytics");
		await expect(headerHeading(page)).toBeVisible({ timeout: 15_000 });
		for (const more of await tree.getByTestId("tree-more").all()) {
			if (await more.isVisible()) await more.click();
		}
		await treeRow(page, resolvedId).getByTestId("tree-incident-link").click();
		await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}(\?|$)/, {
			timeout: 15_000,
		});
	});

	test("empty — a date window with nothing in it", async ({ page }) => {
		const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
		await page.goto(`/incidents?view=all&from=${encodeURIComponent(tomorrow)}`);
		await expect(page.getByTestId("all-empty")).toBeVisible({
			timeout: 15_000,
		});
		await setTheme(page, "light");
		await expect(page.getByTestId("all-empty")).toBeVisible();
	});
});
