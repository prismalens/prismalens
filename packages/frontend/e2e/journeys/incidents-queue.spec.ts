// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import { setTheme, SHOTS } from "./live-stream-fixtures";

/**
 * #523 S2 — the incidents queue: three live numbers over the whole window,
 * the rows that need a human grouped above the rest, and the same keyboard
 * surface every list in the app shares.
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
const shot = (page: Page, name: string) =>
	page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

async function createIncident(page: Page, title: string): Promise<string> {
	const created = await page.request.post("/api/incidents", {
		data: { title },
	});
	expect(created.ok()).toBeTruthy();
	const incident: { id: string } = await created.json();
	return incident.id;
}

/** All rows on one page, so a stray incident from an earlier spec in the
 * suite can never push the rows this test cares about onto page 2. */
async function showAllRows(page: Page): Promise<void> {
	const rowsPerPage = page
		.locator("div")
		.filter({ hasText: "Rows per page" })
		.last()
		.getByRole("combobox");
	await rowsPerPage.click();
	await page.getByRole("option", { name: "100", exact: true }).click();
}

test.describe("#523 S2 — the incidents queue", () => {
	test("stats, grouping and the keyboard surface", async ({ page }) => {
		const stamp = Date.now();
		const triggeredTitle = `Queue triggered ${stamp}`;
		const failedRunTitle = `Queue failed run ${stamp}`;
		const resolvedTitle = `Queue resolved ${stamp}`;
		const closedTitle = `Queue closed ${stamp}`;

		// Created oldest first, in the order a real queue would tend to reach
		// these states: the row that leaves the queue soonest (closed) was
		// opened longest ago, and the one still waiting (triggered) is the
		// newest. The default view sorts by `triggeredAt` desc within the
		// "needs you" / "rest" split (`IncidentDataTable`'s own grouping doesn't
		// re-order across that split, only within it) — creating them in
		// reverse-recency order here keeps the row order this test asserts one
		// the UI's default sort actually produces, not an artifact of four rows
		// landing within the same millisecond.
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

		await page.goto("/incidents");
		await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible({
			timeout: 15_000,
		});
		await setTheme(page, "light");
		await showAllRows(page);

		// The three live numbers.
		const stats = page.getByTestId("queue-stats");
		await expect(stats).toBeVisible();
		const slots = stats.getByTestId("live-slot");
		await expect(slots).toHaveCount(3);
		for (let i = 0; i < 3; i++) {
			await expect(slots.nth(i)).toHaveAttribute("data-state", "live", {
				timeout: 15_000,
			});
		}

		// The grouping and its order: triggered/failed/resolved above closed.
		const needsYouHeader = page.getByTestId("group-needs-you");
		const restHeader = page.getByTestId("group-rest");
		await expect(needsYouHeader).toBeVisible();
		await expect(restHeader).toBeVisible();

		const triggeredRow = page.getByRole("row", { name: new RegExp(triggeredTitle) });
		const failedRow = page.getByRole("row", { name: new RegExp(failedRunTitle) });
		const resolvedRow = page.getByRole("row", { name: new RegExp(resolvedTitle) });
		const closedRow = page.getByRole("row", { name: new RegExp(closedTitle) });
		await expect(triggeredRow).toBeVisible();
		await expect(failedRow).toBeVisible();
		await expect(resolvedRow).toBeVisible();
		await expect(closedRow).toBeVisible();

		const closedBox = await closedRow.boundingBox();
		expect(closedBox).not.toBeNull();
		for (const row of [triggeredRow, failedRow, resolvedRow]) {
			const box = await row.boundingBox();
			expect(box).not.toBeNull();
			expect((box?.y ?? 0)).toBeLessThan(closedBox?.y ?? 0);
		}

		await page.waitForLoadState("networkidle");
		await shot(page, "incidents-queue-default");

		await setTheme(page, "dark");
		await showAllRows(page);
		await page.waitForLoadState("networkidle");
		await shot(page, "incidents-queue-dark");
		await setTheme(page, "light");
		await showAllRows(page);

		// The "Open" slot filters, and closed rows disappear. The router
		// serialises a string search param as JSON, so `open=1` reaches the URL
		// as `open=%221%22`, not a bare `1`.
		await page.getByTestId("queue-stat-open").click();
		await expect(page).toHaveURL(/[?&]open=/);
		await expect(closedRow).toHaveCount(0);
		await page.getByTestId("queue-stat-open").click();
		await expect(page).not.toHaveURL(/[?&]open=/);

		// `?` opens the shortcut sheet.
		await page.keyboard.press("?");
		await expect(page.getByTestId("shortcut-sheet")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("shortcut-sheet")).toHaveCount(0);

		// `g` then `a` goes to the alerts front door.
		await page.keyboard.press("g");
		await page.keyboard.press("a");
		await expect(page).toHaveURL(/\/alerts(\?|$)/);

		// `j` then `Enter` opens the highlighted (first) row. `useListKeyboard`
		// clamps the cursor to `count - 1`, so a `j` pressed before the table's
		// own row fetch resolves (count still 0) never gets off `-1` — wait for
		// a real row, not just the heading.
		await page.goto("/incidents");
		await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByText(resolvedTitle).first()).toBeVisible({
			timeout: 15_000,
		});
		await page.keyboard.press("j");
		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/, {
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
		await page.waitForLoadState("networkidle");
		await shot(page, "incidents-queue-empty");
	});
});
