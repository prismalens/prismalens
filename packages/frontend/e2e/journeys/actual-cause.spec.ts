// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

/**
 * #338 — Resolve records what actually caused the incident, and the incident
 * then shows it. The similarity half (a later incident's report citing this
 * cause) needs a completed investigation, so it is covered by the overlay unit
 * tests; what is reachable without a harness is the capture, which is what this
 * spec drives, through the real API.
 */

/** Resolve is the band's one action once the incident is acknowledged (R1a d7). */
async function resolveFromBand(page: Page): Promise<void> {
	await page.getByTestId("band-acknowledge").click();
	await page.getByTestId("band-resolve").click();
}

async function createFromHeader(page: Page, title: string): Promise<void> {
	await page.goto("/incidents");
	await page.getByTestId("create-incident-button").click({ timeout: 15_000 });
	const dialog = page.getByTestId("create-incident-dialog");
	await dialog.getByTestId("create-incident-title").fill(title);
	await dialog.getByTestId("create-incident-submit").click();
	await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/, {
		timeout: 15_000,
	});
}

test.describe("#338 — the actual cause is recorded on Resolve", () => {
	test("captures cause and category, and shows them on the incident", async ({
		page,
	}) => {
		const title = `Connection pool exhausted ${Date.now()}`;
		const cause = "deploy 41 dropped DB_POOL_SIZE from 50 to 5";
		await createFromHeader(page, title);

		await resolveFromBand(page);
		const dialog = page.getByTestId("resolve-dialog");
		await dialog.getByTestId("resolve-cause").fill(cause);
		await dialog.getByTestId("resolve-category").click();
		await page.getByRole("option", { name: "Configuration" }).click();
		await dialog.getByTestId("confirm-resolve").click();

		await expect(page.getByTestId("band-status")).toHaveText("Resolved", {
			timeout: 15_000,
		});
		await expect(page.getByTestId("actual-cause")).toContainText(
			`Configuration: ${cause}`,
		);
		await expect(page.getByTestId("band-resolve")).toHaveCount(0);
	});

	test("resolving with an empty cause records nothing", async ({ page }) => {
		const title = `Resolved without a cause ${Date.now()}`;
		await createFromHeader(page, title);
		const id = new URL(page.url()).pathname.split("/").pop();

		await resolveFromBand(page);
		await page.getByTestId("confirm-resolve").click();

		await expect(page.getByTestId("band-status")).toHaveText("Resolved", {
			timeout: 15_000,
		});
		await expect(page.getByTestId("cause-text")).toHaveText(
			"No cause recorded",
		);
		const res = await page.request.get(`/api/incidents/${id}`);
		const stored = (await res.json()) as {
			actualCause: string | null;
			actualCauseCategory: string | null;
		};
		expect(stored.actualCause ?? null).toBeNull();
		expect(stored.actualCauseCategory ?? null).toBeNull();
	});
});
