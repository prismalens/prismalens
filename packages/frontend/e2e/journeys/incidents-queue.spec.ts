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
		.getByRole("heading", { name: "Operations", exact: true });
}

/** A thread on the Threads page; the sidebar shows only the latest twelve (#1020). */
function treeRow(page: Page, id: string) {
	return page.getByRole("main").locator(`a[href*="${id}"]`);
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

		await expect(page.getByTestId("thread-list")).toBeVisible({
			timeout: 15_000,
		});
		await page.goto(`/threads?q=${stamp}`);

		const triggeredRow = treeRow(page, triggeredId);
		const failedRow = treeRow(page, failedRunId);
		const resolvedRow = treeRow(page, resolvedId);
		const closedRow = treeRow(page, closedId);
		await expect(triggeredRow).toBeVisible();
		await expect(failedRow).toBeVisible();
		await expect(resolvedRow).toBeVisible();
		// A closed incident stays one search away on the Threads page (#1020).
		await expect(closedRow).toHaveCount(1);

		// `?` opens the shortcut sheet.
		await page.keyboard.press("?");
		await expect(page.getByTestId("shortcut-sheet")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("shortcut-sheet")).toHaveCount(0);

		// `[` hides the sidebar, leaving a show button, and brings it back (#848).
		const sidebar = page.getByTestId("sidebar");
		await expect(sidebar).toBeVisible();
		const width = async () => (await sidebar.boundingBox())?.width;
		expect(await width()).toBe(260);
		await page.keyboard.press("[");
		await expect(sidebar).toHaveCount(0);
		await expect(page.getByTestId("sidebar-show")).toBeVisible();
		await page.keyboard.press("[");
		await expect.poll(width).toBe(260);
		await expect(sidebar.getByTestId("nav-automation")).toBeVisible();

		// `g` then `a` goes to the alerts front door.
		await page.keyboard.press("g");
		await page.keyboard.press("a");
		await expect(page).toHaveURL(/\/alerts(\/|\?|$)/);

		// Clicking a thread on the Threads page opens the incident overview
		await page.goto(`/threads?q=${stamp}`);
		await treeRow(page, resolvedId).click();
		await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}(\?|$)/, {
			timeout: 15_000,
		});
	});

	test("All incidents keeps a 90-day range from Analytics (#673 w6-35)", async ({
		page,
	}) => {
		const from = new Date(Date.now() - 90 * 86_400_000).toISOString();
		await page.goto(`/incidents?view=all&from=${encodeURIComponent(from)}`);
		await expect(page.getByTestId("board-window")).toHaveText("90 days", {
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
