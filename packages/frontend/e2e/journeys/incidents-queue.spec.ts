// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import { setTheme } from "./live-stream-fixtures";

/**
 * #523 S2/final — the incidents queue: the rows that need a human grouped
 * above the rest in the fixed left pane, and the same keyboard surface every
 * list in the app shares. Its numbers moved to Analytics (analytics.feature).
 *
 * "A failed run" needs an investigation the demo seed never wrote (its two
 * seeded investigations both completed). Rather than actually driving a run
 * to failure through the stub harness, the incident's own `GET /api/incidents`
 * row is given one synthetic `investigations[0]` entry with a terminal
 * status — the same one-field-rewrite technique the journeys spec's
 * `serveInvestigationAs` uses, applied to the list response instead of the
 * detail one, because that is what the queue's attention grouping actually
 * reads (`incident.investigations?.[0]?.status`, not a separate query).
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

function paneHeading(page: Page) {
	return page
		.getByTestId("incident-list-pane")
		.getByRole("heading", { name: "Incidents", exact: true });
}

function row(page: Page, title: string) {
	return page.getByTestId("incident-row").filter({ hasText: title });
}

test.describe("#523 S2/final — the incidents queue", () => {
	test("grouping and the keyboard surface", async ({ page }) => {
		const stamp = Date.now();
		const triggeredTitle = `Queue triggered ${stamp}`;
		const failedRunTitle = `Queue failed run ${stamp}`;
		const resolvedTitle = `Queue resolved ${stamp}`;
		const closedTitle = `Queue closed ${stamp}`;

		// Created oldest first, in the order a real queue would tend to reach
		// these states: the row that leaves the queue soonest (closed) was
		// opened longest ago, and the one still waiting (triggered) is the
		// newest.
		const closedId = await createIncident(page, closedTitle);
		await page.request.post(`/api/incidents/${closedId}/resolve`);
		await page.request.post(`/api/incidents/${closedId}/close`, {
			data: {},
		});

		await createIncident(page, triggeredTitle);

		const failedRunId = await createIncident(page, failedRunTitle);
		await page.request.patch(`/api/incidents/${failedRunId}`, {
			data: { status: "investigating" },
		});

		const resolvedId = await createIncident(page, resolvedTitle);
		await page.request.post(`/api/incidents/${resolvedId}/resolve`);

		// The list route is real for every row; only the failed-run incident's
		// entry gets a synthetic `investigations[0]`, the seed writes none.
		await page.route(
			(url) => url.pathname === "/api/incidents",
			async (route) => {
				if (route.request().method() !== "GET") {
					await route.fallback();
					return;
				}
				const response = await route.fetch();
				const body = (await response.json()) as {
					data: Array<Record<string, unknown>>;
					total: number;
				};
				const now = new Date().toISOString();
				const patched = {
					...body,
					data: body.data.map((incident) =>
						incident.id === failedRunId
							? {
									...incident,
									investigations: [
										{
											id: "f0000000-0000-4000-8000-000000000000",
											status: "failed",
											rootCause: null,
											createdAt: now,
											completedAt: now,
										},
									],
								}
							: incident,
					),
				};
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(patched),
				});
			},
		);

		await page.goto("/incidents?view=analytics");
		await expect(paneHeading(page)).toBeVisible({ timeout: 15_000 });
		await setTheme(page, "light");

		// The sidebar groups by service; these hand-made incidents have none, so
		// they sit in No service. Closed ones wait below it in Settled, folded.
		const groups = page.getByTestId("sidebar-group");
		const noService = groups.filter({
			has: page.locator('[data-lane="none"]'),
		});
		await expect(noService).toHaveCount(1);
		await expect(groups.last()).toContainText("Settled");
		await expect(groups.nth((await groups.count()) - 2)).toContainText(
			"No service",
		);

		const triggeredRow = row(page, triggeredTitle);
		const failedRow = row(page, failedRunTitle);
		const resolvedRow = row(page, resolvedTitle);
		const closedRow = row(page, closedTitle);
		await expect(triggeredRow).toBeVisible();
		await expect(failedRow).toBeVisible();
		await expect(resolvedRow).toBeVisible();
		await expect(closedRow).toHaveCount(0);
		await groups.last().getByTestId("service-lane").click();
		await expect(closedRow).toBeVisible();

		// A row is one line: the glyph and the title. The state rides in hidden text.
		await expect(triggeredRow.getByTestId("incident-attention")).toHaveText(
			"Needs acknowledging",
		);
		await expect(failedRow.getByTestId("incident-attention")).toHaveText(
			"Run failed",
		);
		await expect(triggeredRow).toHaveAttribute("title", /INC-\d+/);

		const closedY = (await closedRow.boundingBox())?.y ?? 0;
		for (const r of [triggeredRow, failedRow, resolvedRow]) {
			const box = await r.boundingBox();
			expect(box).not.toBeNull();
			expect(box?.y ?? 0).toBeLessThan(closedY);
		}

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

		// `j` then `Enter` from the analytics overview opens the highlighted
		// (first) row. `useListKeyboard` clamps the cursor to `count - 1`, so a
		// `j` pressed before the pane's own row fetch resolves (count still 0)
		// never gets off `-1` — wait for a real row, not just the heading.
		await page.goto("/incidents?view=analytics");
		await expect(paneHeading(page)).toBeVisible({ timeout: 15_000 });
		await expect(row(page, resolvedTitle)).toBeVisible({ timeout: 15_000 });
		// The pointer lights a row only while over it (CSS :hover); leaving the
		// list must not leave a keyboard cursor behind on the last row it crossed.
		await row(page, resolvedTitle).hover();
		await page.mouse.move(1, 1);
		await expect(page.locator("[data-cursor]")).toHaveCount(0);
		await page.keyboard.press("j");
		await expect(page.locator("[data-cursor]")).toHaveCount(1);
		await page.keyboard.press("Enter");
		// Opening a row keeps the frame's other search params (`view=analytics`
		// among them), so the id is followed by a query string, not the end of
		// the URL.
		await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}(\?|$)/, {
			timeout: 15_000,
		});
	});

	test("empty — a date window with nothing in it", async ({ page }) => {
		const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
		await page.goto(`/incidents?from=${encodeURIComponent(tomorrow)}`);
		await expect(page.getByTestId("incidents-empty-state")).toBeVisible({
			timeout: 15_000,
		});
		await setTheme(page, "light");
		await expect(page.getByTestId("incidents-empty-state")).toBeVisible();
	});
});
