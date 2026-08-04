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

	// Wait for successful login navigation to /
	await expect(page).toHaveURL("http://localhost:3000/");
	await expect(page.getByText("Services", { exact: true })).toBeVisible();

	await page.context().storageState({ path: authFile });
});
