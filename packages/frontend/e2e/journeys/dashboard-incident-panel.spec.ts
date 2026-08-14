// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

/**
 * UX study fixes — the Command Center's incident detail panel
 * (`IncidentDetailPanel`, driven by `orpc.incidents.list`).
 *
 * Two bugs, one panel:
 *  1. `latestInvestigation.rootCause` was always undefined at runtime — the
 *     API's manual serializer and the oRPC output schema both dropped
 *     `rootCause` from the `investigations` relation even though the Prisma
 *     query selected it.
 *  2. The progress bar rendered only when `status === "running"`, but
 *     `incidents.list`'s query filtered investigations to
 *     `status === "completed"` — the two conditions could never both hold, so
 *     the bar could never appear.
 */

const SHOTS = "e2e/journeys/screenshots";

const STORM_INCIDENT_TITLE = "[demo] Storm: High 5xx error rate";
const NO_INVESTIGATION_INCIDENT_TITLE =
	"[demo] Notification Service message queue backlog build-up";
const STORM_ROOT_CAUSE =
	"Connection pool size in auth-service was misconfigured and capped at 10 pool connections after release v2.4.1.";

async function selectIncident(page: Page, titleSubstring: string) {
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible({
		timeout: 15_000,
	});
	await page.getByText(titleSubstring, { exact: false }).first().click();
	await page.getByRole("tab", { name: "Investigation" }).click();
}

/**
 * Demo data ships only completed investigations by design (a permanently
 * `running` row would be a lie about the product — same rationale as
 * live-canvas.spec.ts). Serve the seeded Storm incident's investigation as
 * `running` so the panel takes the in-progress path.
 */
async function serveStormInvestigationAsRunning(page: Page): Promise<void> {
	await page.route(
		(url) => url.pathname === "/api/incidents",
		async (route) => {
			const response = await route.fetch();
			const body = (await response.json()) as {
				data: Array<{
					title: string;
					investigations?: Array<{ status: string }>;
				}>;
			};
			for (const incident of body.data) {
				if (
					incident.title.includes(STORM_INCIDENT_TITLE) &&
					incident.investigations?.[0]
				) {
					incident.investigations[0].status = "running";
				}
			}
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(body),
			});
		},
	);
}

test.describe("UX study — dashboard incident panel (rootCause + progress bar)", () => {
	test("renders latestInvestigation.rootCause for a completed investigation", async ({
		page,
	}) => {
		await selectIncident(page, STORM_INCIDENT_TITLE);
		await expect(page.getByText("Root Cause")).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText(STORM_ROOT_CAUSE)).toBeVisible({
			timeout: 15_000,
		});
		// The bug: status is "completed" here, so the progress bar must not show.
		await expect(page.getByRole("progressbar")).not.toBeVisible();
	});

	test("renders the progress bar when the latest investigation is running", async ({
		page,
	}) => {
		await serveStormInvestigationAsRunning(page);
		await selectIncident(page, STORM_INCIDENT_TITLE);
		await expect(page.getByRole("progressbar")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByText("Investigation in progress...")).toBeVisible();
	});

	test("shows the no-investigation empty state for an incident with none", async ({
		page,
	}) => {
		await selectIncident(page, NO_INVESTIGATION_INCIDENT_TITLE);
		await expect(page.getByText("No investigation yet")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByRole("progressbar")).not.toBeVisible();
	});

	test("design evidence: default, dark, running, and empty states", async ({
		page,
	}) => {
		const shot = (name: string) =>
			page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

		// `page.reload()` re-mounts the Tabs component at its `defaultValue`
		// ("overview"), so the Investigation tab selected before a theme switch
		// does not survive it — re-select after every reload.
		const setTheme = async (theme: "light" | "dark") => {
			await page.evaluate((value) => {
				document.cookie = `prismalens-theme=${value}; path=/; max-age=31536000`;
			}, theme);
			await page.reload();
			await expect(page.locator("html")).toHaveClass(new RegExp(theme));
		};

		const showStormInvestigation = async () => {
			await selectIncident(page, STORM_INCIDENT_TITLE);
			await expect(page.getByText(STORM_ROOT_CAUSE)).toBeVisible({
				timeout: 15_000,
			});
		};

		// Default (light): completed investigation with a rendered root cause.
		await showStormInvestigation();
		await setTheme("light");
		await showStormInvestigation();
		await page.waitForLoadState("networkidle");
		await shot("dashboard-incident-panel-default");

		// Dark.
		await setTheme("dark");
		await showStormInvestigation();
		await page.waitForLoadState("networkidle");
		await shot("dashboard-incident-panel-dark");

		// Empty: an incident with no investigation at all.
		await selectIncident(page, NO_INVESTIGATION_INCIDENT_TITLE);
		await expect(page.getByText("No investigation yet")).toBeVisible({
			timeout: 15_000,
		});
		await page.waitForLoadState("networkidle");
		await shot("dashboard-incident-panel-empty");

		// Running: the fix under test — a synthetic state (see
		// serveStormInvestigationAsRunning), not one of the four canonical
		// design-gate states, captured because it is exactly what Bug 3 fixed.
		await serveStormInvestigationAsRunning(page);
		await selectIncident(page, STORM_INCIDENT_TITLE);
		await expect(page.getByRole("progressbar")).toBeVisible({
			timeout: 15_000,
		});
		await page.waitForLoadState("networkidle");
		await shot("dashboard-incident-panel-running");
	});
});
