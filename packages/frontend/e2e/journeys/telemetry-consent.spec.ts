// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

/**
 * #673 w45 (reverses #602's opt-in): usage data is on by default, the board
 * shows a notice once, and showing it is recorded so sending can start on the
 * next boot. OK or Turn off dismisses it.
 *
 * The state lives in one settings row shared by the whole suite, so every case
 * is served through a route double; the component, the mutation and the
 * contract boundary are real. The PUTs are captured rather than stubbed blind,
 * so the spec proves what the strip actually sends.
 */
interface Flags {
	enabled: boolean;
	forcedOff: boolean;
	noticed: boolean;
	dismissed: boolean;
}
type Put = Partial<Pick<Flags, "enabled" | "noticed" | "dismissed">>;

async function serveTelemetry(
	page: Page,
	flags: Flags,
	recentlySent: Array<{ payload: Record<string, unknown> }> = [],
): Promise<{ puts: Put[] }> {
	const puts: Put[] = [];
	const state = { ...flags, recentlySent };
	await page.route("**/api/settings/telemetry", async (route) => {
		if (route.request().method() === "PUT") {
			const body = route.request().postDataJSON() as Put;
			puts.push(body);
			Object.assign(state, body);
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(state),
			});
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(state),
		});
	});
	return { puts };
}

const FRESH: Flags = {
	enabled: true,
	forcedOff: false,
	noticed: false,
	dismissed: false,
};

test.describe("#673 w45: usage data on after a notice", () => {
	test("the strip records that it was shown, and OK dismisses it", async ({
		page,
	}) => {
		const { puts } = await serveTelemetry(page, FRESH);

		await page.goto("/incidents");
		const notice = page.getByTestId("telemetry-consent");
		await expect(notice).toBeVisible({ timeout: 15_000 });
		await expect(notice).toContainText("Usage counts are on");
		await expect(notice).toContainText("Never an alert, a repo or a report");
		await expect.poll(() => puts).toEqual([{ noticed: true }]);

		await notice.getByRole("button", { name: "OK", exact: true }).click();

		await expect(notice).toHaveCount(0, { timeout: 15_000 });
		expect(puts).toEqual([{ noticed: true }, { dismissed: true }]);
	});

	test("Turn off sends enabled:false and dismisses", async ({ page }) => {
		const { puts } = await serveTelemetry(page, { ...FRESH, noticed: true });

		await page.goto("/incidents");
		const notice = page.getByTestId("telemetry-consent");
		await expect(notice).toBeVisible({ timeout: 15_000 });
		await notice.getByRole("button", { name: "Turn off" }).click();

		await expect(notice).toHaveCount(0, { timeout: 15_000 });
		expect(puts).toEqual([{ enabled: false, dismissed: true }]);
	});

	test("never shows once dismissed, when off, or when the env forces it off", async ({
		page,
	}) => {
		const heading = page
			.getByTestId("incident-list-pane")
			.getByRole("heading", { name: "Incidents", exact: true });
		for (const flags of [
			{ ...FRESH, noticed: true, dismissed: true },
			{ ...FRESH, enabled: false, noticed: true, dismissed: true },
			{ ...FRESH, enabled: false, forcedOff: true },
		]) {
			await page.unrouteAll();
			await serveTelemetry(page, flags);
			await page.goto("/incidents");
			await expect(heading).toBeVisible({ timeout: 15_000 });
			await expect(page.getByTestId("telemetry-consent")).toHaveCount(0);
		}
	});

	test("Settings → Usage data carries the full disclosure and the toggle", async ({
		page,
	}) => {
		await serveTelemetry(page, { ...FRESH, noticed: true, dismissed: true }, [
			{ payload: { event: "install_active", distinct_id: "install-1" } },
		]);

		await page.goto("/settings?tab=usage");
		const checkbox = page.getByRole("switch", {
			name: "Share usage counts",
		});
		await expect(checkbox).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText("On unless you turn it off.")).toBeVisible();
		// The disclosure is folded under the switch (settings.feature); open it.
		await page.getByTestId("telemetry-disclosure").locator("summary").click();
		// Exact, because "what is sent" also appears inside the "Never sent"
		// paragraph and a substring match would resolve to both.
		await expect(page.getByText("What is sent", { exact: true })).toBeVisible();
		await expect(
			page.getByText("The install id", { exact: true }),
		).toBeVisible();
		await expect(page.getByText("An install id:")).toBeVisible();
		await expect(page.getByText("Never sent:")).toBeVisible();
		await expect(
			page.getByText("pseudonymous rather than anonymous"),
		).toBeVisible();
		await expect(
			page.getByText("kept for as long as PostHog's plan retains them"),
		).toBeVisible();
		await expect(
			page.getByText("stops collection from that moment"),
		).toBeVisible();
		await expect(checkbox).toBeChecked();

		const recent = page.getByTestId("telemetry-recent");
		await expect(recent.getByRole("heading")).toHaveText("Recently sent1");
		await recent.getByText("install_active", { exact: true }).click();
		await expect(page.getByText('"event": "install_active"')).toBeVisible();
	});
});
