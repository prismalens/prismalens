// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test as setup } from "@playwright/test";

const authFile = "e2e/.auth/owner.json";

setup("authenticate as owner", async ({ page }) => {
	await page.goto("/auth/login");
	// Ensure React hydration finishes before form submission
	await page.waitForLoadState("networkidle");
	await expect(page.getByText("Sign in to PrismaLens")).toBeVisible();

	await page.locator("#email").fill("admin@prismalens.dev");
	await page.locator("#password").fill("admin123");
	await page.getByRole("button", { name: "Sign in" }).click();

	// Wait for successful login navigation to /incidents — baseURL-relative, so
	// the suite still runs when 3000 is taken and the harness is pointed at
	// another port. The page appends its own ?tab=list, hence the regex.
	await expect(page).toHaveURL(/\/incidents/);
	await expect(
		page.getByRole("link", { name: "Incidents", exact: true }),
	).toBeVisible();

	await page.context().storageState({ path: authFile });
});
