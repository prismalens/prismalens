// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

/**
 * #325 — `Service.team` filters end to end everywhere except the services list,
 * which had no control for it. The options come from the teams services
 * actually carry, the choice is in the URL so a filtered view is linkable, and
 * a team that matches nothing renders the list's empty state.
 *
 * The catalog is shared by the whole suite, so the two list-shaped responses are
 * served through a route double; the control, the URL state and the table are real.
 */
async function serveCatalog(
	page: Page,
	teams: string[],
	byTeam: Record<string, string[]>,
): Promise<{ requestedTeams: Array<string | null> }> {
	const requestedTeams: Array<string | null> = [];

	await page.route("**/api/services/teams*", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ teams }),
		});
	});

	await page.route("**/api/services?*", async (route) => {
		const team = new URL(route.request().url()).searchParams.get("team");
		requestedTeams.push(team);
		const names = team === null ? Object.values(byTeam).flat() : (byTeam[team] ?? []);
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				data: names.map((name, i) => ({
					id: `00000000-0000-4000-8000-00000000000${i}`,
					name,
					displayName: name,
					description: null,
					type: "service",
					tier: "tier_3",
					team: team ?? "platform",
					slackChannel: null,
					tags: null,
					metadata: null,
					createdAt: "2026-09-19T00:00:00.000Z",
					updatedAt: "2026-09-19T00:00:00.000Z",
				})),
				total: names.length,
			}),
		});
	});

	return { requestedTeams };
}

test.describe("#325 — filtering the services list by team", () => {
	test("offers the teams that exist, filters, and puts the choice in the URL", async ({
		page,
	}) => {
		const { requestedTeams } = await serveCatalog(
			page,
			["payments", "platform"],
			{ payments: ["checkout-api"], platform: ["gateway", "scheduler"] },
		);

		await page.goto("/services");
		const filter = page.getByTestId("services-team-filter");
		await expect(filter).toBeVisible({ timeout: 15_000 });

		await filter.click();
		await page.getByRole("option", { name: "payments", exact: true }).click();

		await expect(page).toHaveURL(/team=payments/);
		await expect(page.getByText("checkout-api").first()).toBeVisible({
			timeout: 15_000,
		});
		expect(requestedTeams).toContain("payments");
	});

	test("a link carrying the team filter opens filtered", async ({ page }) => {
		const { requestedTeams } = await serveCatalog(page, ["payments"], {
			payments: ["checkout-api"],
		});

		await page.goto("/services?team=payments");

		await expect(page.getByTestId("services-team-filter")).toContainText(
			"payments",
			{ timeout: 15_000 },
		);
		expect(requestedTeams).toContain("payments");
	});

	test("a team that matches nothing shows the empty state, not a blank table", async ({
		page,
	}) => {
		await serveCatalog(page, ["payments", "ghosts"], {
			payments: ["checkout-api"],
			ghosts: [],
		});

		await page.goto("/services?team=ghosts");

		await expect(page.getByText("checkout-api")).toHaveCount(0);
		await expect(page.getByText(/no services/i).first()).toBeVisible({
			timeout: 15_000,
		});
	});
});
