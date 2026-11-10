// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

/**
 * #1020: a helper thread from an empty page. The shared composer starts a no-subject
 * thread that names only its page; the webhook token stays behind Copy token. The
 * suite's catalog is shared, so the list responses are route doubles.
 */
const THREAD_ID = "f5555555-5555-4555-8555-555555555555";

async function emptyAlerts(page: Page): Promise<void> {
	await page.route(
		(url) => url.pathname.startsWith("/api/alerts"),
		async (route) => {
			if (route.request().method() !== "GET") return route.fallback();
			const { pathname } = new URL(route.request().url());
			if (pathname === "/api/alerts/stats")
				return route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ total: 0, byStatus: {}, bySeverity: {} }),
				});
			if (pathname === "/api/alerts")
				return route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						data: [],
						pagination: { total: 0, limit: 100, offset: 0, hasMore: false },
					}),
				});
			return route.fallback();
		},
	);
}

async function captureStart(
	page: Page,
): Promise<{ body: () => string | null }> {
	let sent: string | null = null;
	await page.route(
		(url) => url.pathname === "/api/threads",
		async (route) => {
			if (route.request().method() !== "POST") return route.fallback();
			sent = route.request().postData();
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					investigationId: THREAD_ID,
					jobId: "job-1",
					queued: true,
				}),
			});
		},
	);
	return { body: () => sent };
}

test.describe("helper threads on empty pages (#1020)", () => {
	test("the empty Alerts page starts a no-subject thread that names its page and carries no token", async ({
		page,
	}) => {
		await emptyAlerts(page);
		const start = await captureStart(page);
		const tokenRes = await page.request.get("/api/webhooks/token");
		expect(tokenRes.ok()).toBe(true);
		const { token } = (await tokenRes.json()) as { token: string };
		expect(typeof token).toBe("string");
		expect(token.length).toBeGreaterThan(0);

		await page.goto("/alerts");
		const helper = page.getByTestId("helper-thread");
		await expect(helper).toHaveAttribute("data-place", "alerts", {
			timeout: 20_000,
		});
		await expect(page.getByTestId("alerts-copy-url")).toBeVisible();
		const input = helper.getByTestId("composer-input");
		await expect(input).toHaveAttribute(
			"placeholder",
			"Ask how to send alerts",
		);
		await expect(input).not.toBeFocused();

		await input.fill("How do I send alerts here?");
		await input.press("Enter");
		await expect(page).toHaveURL(new RegExp(`/threads/${THREAD_ID}`));
		const body = start.body() ?? "";
		expect(JSON.parse(body)).toMatchObject({
			subject: { kind: "none" },
			text: "How do I send alerts here?",
			place: "alerts",
		});
		expect(body).not.toContain(token);
	});

	test("the empty Services page offers the same composer for its page", async ({
		page,
	}) => {
		await page.route("**/api/services/teams*", (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ teams: [] }),
			}),
		);
		await page.route("**/api/services?*", (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ data: [], total: 0 }),
			}),
		);
		await page.goto("/services");
		const helper = page.getByTestId("helper-thread");
		await expect(helper).toHaveAttribute("data-place", "services", {
			timeout: 20_000,
		});
		await expect(helper.getByTestId("composer-input")).toHaveAttribute(
			"placeholder",
			"Ask how to add a service",
		);
	});
});
