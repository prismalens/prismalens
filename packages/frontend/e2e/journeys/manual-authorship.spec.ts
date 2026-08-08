// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

/**
 * J17 / C10 — manual authorship.
 *
 * The journey a `pl up` user has when nothing is wired up yet: author an
 * incident by hand from `/incidents`, then investigate it from its detail
 * page. This is the first spec in the suite that drives a *write* path on the
 * incidents surface — `incidents.create` followed by `incidents.investigate`.
 *
 * The AI-provider precondition is set through the API, not the settings UI:
 * it belongs to C6's gate, not to this journey, and setting it up front keeps
 * the spec idempotent under Playwright retries (`activeProvider` is global
 * state that survives a retry against the same database).
 */
test.describe("C10 — manual authorship without an alert source", () => {
	test("creates an incident by hand and starts an investigation from it", async ({
		page,
	}) => {
		const title = `Checkout latency spike ${Date.now()}`;

		// 0. Precondition: an investigation cannot start without a provider.
		const configured = await page.request.patch("/api/settings/llm/config", {
			data: { activeProvider: "anthropic" },
		});
		expect(configured.ok()).toBeTruthy();

		// 1. The incidents page offers the authorship affordance.
		await page.goto("/incidents");
		await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible({
			timeout: 15_000,
		});
		await page.getByTestId("create-incident-button").click();

		// 2. The form calls incidents.create and lands on the new incident.
		const dialog = page.getByTestId("create-incident-dialog");
		await expect(dialog).toBeVisible();
		await dialog.getByTestId("create-incident-title").fill(title);
		await dialog
			.getByTestId("create-incident-description")
			.fill("Authored by hand — no alert source is wired up.");
		await dialog.getByTestId("create-incident-submit").click();

		await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/, {
			timeout: 15_000,
		});
		await expect(page.getByRole("heading", { name: title })).toBeVisible({
			timeout: 15_000,
		});

		// 3. A hand-authored incident carries no alerts, and the UI says so
		//    rather than implying a correlation that never happened.
		await expect(page.getByRole("tab", { name: "Alerts (0)" })).toBeVisible();

		// 4. Start the investigation — incidents.investigate must accept an
		//    incident that has zero alerts.
		await page.getByRole("tab", { name: "Investigation" }).click();
		await expect(page.getByTestId("start-investigation")).toBeEnabled({
			timeout: 15_000,
		});
		await page.getByTestId("start-investigation").click();

		// 5. An investigation exists and the app routed to it.
		await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/, {
			timeout: 20_000,
		});
	});

	/**
	 * Design evidence for the frontend gate (AGENTS.md). Captures the changed
	 * surfaces in both themes plus the empty and error states, the same way
	 * #237's `single-origin.spec.ts` captures the artifact's.
	 */
	test("design evidence: both themes, the empty state, and the error state", async ({
		page,
	}) => {
		const shot = (name: string) =>
			page.screenshot({
				path: `e2e/journeys/screenshots/${name}.png`,
				fullPage: true,
			});

		// The dialog, light.
		await page.goto("/incidents");
		await page.evaluate(() => {
			document.cookie = "prismalens-theme=light; path=/; max-age=31536000";
		});
		await page.reload();
		await expect(page.locator("html")).toHaveClass(/light/);
		await page.getByTestId("create-incident-button").click();
		await expect(page.getByTestId("create-incident-dialog")).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot("create-incident-dialog-light");

		// The same dialog, dark.
		await page.evaluate(() => {
			document.cookie = "prismalens-theme=dark; path=/; max-age=31536000";
		});
		await page.reload();
		await expect(page.locator("html")).toHaveClass(/dark/);
		await page.getByTestId("create-incident-button").click();
		await expect(page.getByTestId("create-incident-dialog")).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot("create-incident-dialog-dark");

		// The error state: a create the API refuses is reported inside the
		// dialog, and the draft is left intact so it can be retried.
		await page.route("**/api/incidents", async (route) => {
			if (route.request().method() === "POST") {
				await route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({ message: "Internal server error" }),
				});
				return;
			}
			await route.fallback();
		});
		await page
			.getByTestId("create-incident-title")
			.fill("An incident the server refuses");
		await page.getByTestId("create-incident-submit").click();
		await expect(page.getByTestId("create-incident-error")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("create-incident-dialog")).toBeVisible();
		await shot("create-incident-error");
		await page.unroute("**/api/incidents");

		// The empty state — what a fresh install sees. The seeded database has
		// incidents, so a future `from` filter is what makes the table empty
		// deterministically.
		const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
		await page.goto(`/incidents?from=${encodeURIComponent(tomorrow)}`);
		await expect(page.getByTestId("incidents-empty-state")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("incidents-empty-create")).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot("incidents-empty-state");
	});

	test("cannot submit an incident with no title", async ({ page }) => {
		await page.goto("/incidents");
		await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible({
			timeout: 15_000,
		});
		await page.getByTestId("create-incident-button").click();

		const dialog = page.getByTestId("create-incident-dialog");
		await expect(dialog).toBeVisible();

		// Submit stays disabled until the one required field holds real text, so
		// the dialog cannot POST an incident the API would reject.
		await expect(dialog.getByTestId("create-incident-submit")).toBeDisabled();

		await dialog.getByTestId("create-incident-title").fill("   ");
		await expect(dialog.getByTestId("create-incident-submit")).toBeDisabled();

		await dialog.getByTestId("create-incident-title").fill("Has a title now");
		await expect(dialog.getByTestId("create-incident-submit")).toBeEnabled();
	});
});
