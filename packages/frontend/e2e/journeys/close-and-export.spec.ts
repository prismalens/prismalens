// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

/**
 * #606 — after the report. Two affordances the journey trace found missing:
 * nothing ended an incident, and a report could not leave the page.
 *
 * Both are driven against the real API: the incident is authored by hand (the
 * same path `manual-authorship.spec.ts` uses), then resolved in one step. The
 * export button belongs to a completed report, which needs a harness, so the
 * spec asserts the half that is reachable without one: it is absent until a
 * report exists.
 */
test.describe("#606 — closing an incident and exporting its report", () => {
	test("resolves a hand-authored incident in one step", async ({ page }) => {
		const title = `Pool exhaustion ${Date.now()}`;

		await page.goto("/incidents");
		await page.getByTestId("create-incident-button").click({ timeout: 15_000 });

		const dialog = page.getByTestId("create-incident-dialog");
		await expect(dialog).toBeVisible();
		await dialog.getByTestId("create-incident-title").fill(title);
		await dialog.getByTestId("create-incident-submit").click();

		await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/, {
			timeout: 15_000,
		});
		await expect(
			page
				.getByTestId("incident-state-band")
				.getByRole("heading", { name: title }),
		).toBeVisible({
			timeout: 15_000,
		});

		// The band's one action follows the status: Acknowledge, then Resolve
		// (R1a d7). Nothing reads "Close" any more.
		const resolve = page.getByTestId("band-resolve");
		await expect(resolve).toHaveCount(0);
		await page.getByTestId("band-acknowledge").click();
		await expect(resolve).toBeVisible({ timeout: 15_000 });

		// #338's question rides on Resolve; both fields blank is allowed.
		await resolve.click();
		await page.getByTestId("confirm-resolve").click();
		await expect(resolve).toHaveCount(0, { timeout: 15_000 });
		await expect(page.getByTestId("band-status")).toHaveText("Resolved");
		await expect(page.getByTestId("band-reopen")).toBeVisible();
		// A resolved incident can still be investigated again (#743), from the
		// box on Overview; its status stays Resolved.
		await expect(page.getByTestId("composer-investigate")).toBeVisible();
	});

	test("offers no Markdown export while the incident has no report", async ({
		page,
	}) => {
		const title = `No report yet ${Date.now()}`;

		await page.goto("/incidents");
		await page.getByTestId("create-incident-button").click();
		const dialog = page.getByTestId("create-incident-dialog");
		await dialog.getByTestId("create-incident-title").fill(title);
		await dialog.getByTestId("create-incident-submit").click();
		await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/, {
			timeout: 15_000,
		});

		await expect(page.getByTestId("export-report-markdown")).toHaveCount(0);
		await expect(page.getByTestId("post-report-github")).toHaveCount(0);
	});

	test("posts a completed report to a GitHub issue or PR (success and refusal)", async ({
		page,
	}) => {
		const setTheme = async (theme: "light" | "dark") => {
			await page.evaluate((value) => {
				document.cookie = `prismalens-theme=${value}; path=/; max-age=31536000`;
			}, theme);
			await page.reload();
			await expect(page.locator("html")).toHaveClass(new RegExp(theme));
		};

		// 1. Intercept route with 412 PRECONDITION_FAILED
		await page.route("**/api/investigations/*/report/github", async (route) => {
			if (route.request().method() === "POST") {
				await route.fulfill({
					status: 412,
					contentType: "application/json",
					body: JSON.stringify({
						code: "PRECONDITION_FAILED",
						message:
							"No GitHub connection is configured (Settings → Integrations)",
						data: {
							code: "PRECONDITION_FAILED",
							message:
								"No GitHub connection is configured (Settings → Integrations)",
						},
					}),
				});
				return;
			}
			await route.fallback();
		});

		// The report is its own route under the incident (#743); its answer
		// carries the root cause text (study-v3 §3.2).
		await page.goto(
			"/incidents/b0111111-1111-4111-8111-111111111111/report?investigation=d0111111-1111-4111-8111-111111111111",
		);
		await expect(page.getByTestId("report-answer")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("report-answer")).toContainText(
			"Connection pool size in auth-service was misconfigured",
		);

		// Buttons are visible beside each other
		const postBtn = page.getByTestId("post-report-github");
		await expect(postBtn).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("export-report-markdown")).toBeVisible();

		await setTheme("light");
		await expect(page.getByTestId("post-report-github")).toBeVisible({
			timeout: 15_000,
		});
		await page.getByTestId("post-report-github").click();
		await expect(page.getByRole("dialog")).toBeVisible();
		await expect(page.getByTestId("post-report-github-url")).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog")).toHaveCount(0);

		await setTheme("dark");
		await expect(page.getByTestId("post-report-github")).toBeVisible({
			timeout: 15_000,
		});
		await page.getByTestId("post-report-github").click();
		await expect(page.getByRole("dialog")).toBeVisible();

		// (b) 412-shaped oRPC error → not-configured line visible
		await page
			.getByTestId("post-report-github-url")
			.fill("https://github.com/prismalens/prismalens/issues/123");
		await page.getByTestId("post-report-github-submit").click();

		await expect(
			page.getByText("No GitHub connection is configured"),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByRole("link", { name: "Settings, Integrations" }),
		).toBeVisible();

		// Unroute 412, close dialog
		await page.unroute("**/api/investigations/*/report/github");
		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog")).toHaveCount(0);

		// Switch back to light theme
		await setTheme("light");

		// (a) 201 success → toast text
		const commentUrl =
			"https://github.com/prismalens/prismalens/issues/123#issuecomment-9999";
		await page.route("**/api/investigations/*/report/github", async (route) => {
			if (route.request().method() === "POST") {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ commentUrl }),
				});
				return;
			}
			await route.fallback();
		});

		await page.getByTestId("post-report-github").click();
		await expect(page.getByRole("dialog")).toBeVisible();
		await page
			.getByTestId("post-report-github-url")
			.fill("https://github.com/prismalens/prismalens/issues/123");
		await page.getByTestId("post-report-github-submit").click();

		// The toast title and its screen-reader announcement both carry the text.
		await expect(page.getByText("Posted", { exact: true }).first()).toBeVisible(
			{
				timeout: 15_000,
			},
		);
		await expect(page.getByRole("link", { name: commentUrl })).toBeVisible();
		await expect(page.getByRole("dialog")).toHaveCount(0);

		await page.unroute("**/api/investigations/*/report/github");
	});
});
