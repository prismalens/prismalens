// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import {
	eventFactory,
	INVESTIGATION_ID,
	serveEventsHistory,
	serveInvestigationAs,
	setTheme,
	SHOTS,
} from "./live-stream-fixtures";

/**
 * #523 S1 — the incident record: a state band that never scrolls, the
 * durable record in sections, a live sidecar rail, and a composer docked
 * across the bottom.
 *
 * The demo seed's incident #1 (`INCIDENT_ID`) already carries a completed
 * investigation with a full report — the happy path reuses it rather than
 * hand-authoring one. The seed writes no canonical event rows for it though
 * (the report is the only durable artifact demo data gives an investigation),
 * so the ledger's ledger-unfold assertion fakes a few event rows onto the
 * real `GET .../events` response the same way `live-stream-fixtures.ts`
 * fakes the `running` status elsewhere: one field of a real response.
 */
const INCIDENT_ID = "b0111111-1111-4111-8111-111111111111";

const shot = (page: Page, name: string) =>
	page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

test.describe("#523 S1 — the incident record", () => {
	test("bands, sections, ledger, rail and composer for a completed run", async ({
		page,
	}) => {
		const events = eventFactory("root");
		await serveEventsHistory(page, INVESTIGATION_ID, [
			events.agentStep("scout", "Mapping the connection pool"),
			events.toolResult("search_logs", "412 matching lines"),
			events.branchDone(),
		]);

		await page.goto(`/incidents/${INCIDENT_ID}`);
		await setTheme(page, "light");

		// The band: id, severity, title, status. The run's own state lives in
		// the rail (`rail-working-now` while live, `rail-run-summary` once the
		// run has a terminal status), asserted below.
		const band = page.getByTestId("incident-state-band");
		await expect(band).toBeVisible({ timeout: 15_000 });
		await expect(band).toContainText("INC-1");
		// The severity dot carries its label as `aria-label`/`title`, not text.
		await expect(band.getByLabel("Critical")).toBeVisible();
		await expect(
			band.getByRole("heading", {
				name: "[demo] Storm: High 5xx error rate on API Gateway & Auth timeout",
			}),
		).toBeVisible();
		await expect(band.getByTestId("band-status")).toBeVisible();

		// The sections, in document order (#alerts and #timeline moved to surfaces).
		const ids = ["#report", "#evidence", "#ledger"];
		const ys: number[] = [];
		for (const id of ids) {
			const box = await page.locator(id).boundingBox();
			expect(box, `${id} has a bounding box`).not.toBeNull();
			ys.push(box?.y ?? 0);
		}
		for (let i = 1; i < ys.length; i++) {
			expect(ys[i], `${ids[i]} sits below ${ids[i - 1]}`).toBeGreaterThan(
				ys[i - 1],
			);
		}

		// The ledger folds after completion, then unfolds on request.
		const panel = page.getByTestId("investigation-stream-panel");
		await expect(panel).toHaveAttribute("data-folded", "true");
		await page.getByTestId("ledger-toggle").click();
		await expect(panel).not.toHaveAttribute("data-folded", "true");
		await expect(panel.getByTestId("stream-event-row")).toHaveCount(3);

		// The surfaces: surface-rail and surface-pane-run.
		const rail = page.getByTestId("surface-rail");
		await expect(rail).toBeVisible();
		await expect(page.getByTestId("surface-run")).toBeVisible();
		await expect(page.getByTestId("surface-alerts")).toBeVisible();
		await expect(page.getByTestId("surface-timeline")).toBeVisible();
		await expect(page.getByTestId("surface-telemetry")).toBeVisible();

		const runPane = page.getByTestId("surface-pane-run");
		await expect(runPane).toBeVisible();
		await expect(runPane.getByTestId("rail-run-summary")).toBeVisible();
		await expect(runPane.getByTestId("rail-details")).toBeVisible();

		// Telemetry surface holds live-slot
		await page.keyboard.press("m");
		const telemetryPane = page.getByTestId("surface-pane-telemetry");
		await expect(telemetryPane).toBeVisible();
		const liveSlot = telemetryPane.getByTestId("live-slot").first();
		await expect(liveSlot).toHaveAttribute("data-state", "not-configured");

		// The composer: a plain note lands on the timeline.
		const note = `Design evidence note ${Date.now()}`;
		await page.getByTestId("composer-input").fill(note);
		await page.getByTestId("composer-input").press("Enter");
		await page.getByTestId("composer-input").blur();
		// Open timeline surface ('t') before asserting note
		await page.keyboard.press("t");
		const timelinePane = page.getByTestId("surface-pane-timeline");
		await expect(timelinePane).toBeVisible();
		await expect(timelinePane).toContainText(note);

		// `/` opens the command palette.
		await page.getByTestId("composer-input").fill("/");
		await expect(page.getByTestId("composer-commands")).toBeVisible();
		await expect(page.getByTestId("composer-command-investigate")).toBeVisible();
		await page.getByTestId("composer-input").press("Escape");
		await expect(page.getByTestId("composer-commands")).toHaveCount(0);

		await page.waitForLoadState("networkidle");
		await shot(page, "incident-record-default");

		await setTheme(page, "dark");
		await expect(panel).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot(page, "incident-record-dark");
	});

	test("record surfaces keyboard navigation (r, a, t, m, and ])", async ({
		page,
	}) => {
		await page.goto(`/incidents/${INCIDENT_ID}`);
		await expect(page.getByTestId("surface-rail")).toBeVisible({
			timeout: 15_000,
		});

		// Default surface is run
		await expect(page.getByTestId("surface-pane-run")).toBeVisible();

		// 'a' switches to alerts surface
		await page.keyboard.press("a");
		await expect(page.getByTestId("surface-pane-alerts")).toBeVisible();

		// 't' switches to timeline surface
		await page.keyboard.press("t");
		await expect(page.getByTestId("surface-pane-timeline")).toBeVisible();

		// 'm' switches to telemetry surface
		await page.keyboard.press("m");
		await expect(page.getByTestId("surface-pane-telemetry")).toBeVisible();

		// 'r' switches to run surface
		await page.keyboard.press("r");
		await expect(page.getByTestId("surface-pane-run")).toBeVisible();

		// ']' hides the surface pane
		await page.keyboard.press("]");
		await expect(page.getByTestId("surface-pane-run")).toHaveCount(0);

		// ']' shows the surface pane again
		await page.keyboard.press("]");
		await expect(page.getByTestId("surface-pane-run")).toBeVisible();
	});

	test("empty — an incident with no run", async ({ page }) => {
		const title = `No investigation yet ${Date.now()}`;
		const created = await page.request.post("/api/incidents", {
			data: { title },
		});
		expect(created.ok()).toBeTruthy();
		const incident: { id: string } = await created.json();

		await page.goto(`/incidents/${incident.id}`);
		await expect(page.getByTestId("investigation-empty")).toBeVisible({
			timeout: 15_000,
		});
		await setTheme(page, "light");
		await expect(page.getByTestId("investigation-empty")).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot(page, "incident-record-empty");
	});

	test("error — a failed run", async ({ page }) => {
		await serveInvestigationAs(page, INVESTIGATION_ID, {
			status: "failed",
			error: "harness lost the tool socket",
		});

		await page.goto(`/incidents/${INCIDENT_ID}`);
		await expect(page.getByTestId("investigation-failed-state")).toBeVisible({
			timeout: 15_000,
		});
		await setTheme(page, "light");
		await expect(page.getByTestId("investigation-failed-state")).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot(page, "incident-record-error");
	});
});
