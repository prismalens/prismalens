// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

test.describe("C1 — Service catalog & discovery journey", () => {
	test("displays catalog services, service detail, and discovery page", async ({
		page,
	}) => {
		// 1. Navigate to /services and assert all 5 seeded service names are visible
		await page.goto("/services");
		await expect(page.getByRole("heading", { name: "Services" })).toBeVisible({
			timeout: 15_000,
		});

		for (const serviceName of [
			"api-gateway",
			"auth-service",
			"payment-service",
			"notification-service",
			"analytics-pipeline",
		]) {
			await expect(
				page.getByText(serviceName, { exact: false }).first(),
			).toBeVisible({ timeout: 15_000 });
		}

		// 2. Navigate to /services/$id (api-gateway) and assert service detail title & tier
		await page.goto("/services/11111111-1111-4111-8111-111111111111");
		await expect(
			page.getByRole("heading", { name: "API Gateway" }),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByText("Critical", { exact: false }).first(),
		).toBeVisible({ timeout: 15_000 });

		// 3. Navigate to /services/discovery and assert page renders cleanly
		await page.goto("/services/discovery");
		await expect(
			page.getByRole("heading", { name: "Discovered Services" }),
		).toBeVisible({ timeout: 15_000 });
	});
});
