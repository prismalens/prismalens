// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import {
	deliver,
	eventFactory,
	hideQueryDevtools,
	INVESTIGATION_ID,
	installStreamDouble,
	serveAsRunning,
	serveEventsHistory,
	serveInvestigationAs,
	setTheme,
} from "./live-stream-fixtures";
import { settled } from "./settled";

/**
 * #743 — the incident: a band and a run strip that never scroll, a reading
 * column with the facts rail beside it (study-v3 §3.3) and the box docked
 * under it, and the routes one level down (conversation, report, alerts,
 * timeline).
 *
 * The demo seed's incident #1 (`INCIDENT_ID`) already carries a completed
 * investigation with a full report; the happy path reuses it. The seed writes
 * no canonical event rows for it, so the conversation's events are faked onto
 * the real `GET .../events` response the same way `live-stream-fixtures.ts`
 * fakes the `running` status elsewhere.
 */
const INCIDENT_ID = "b0111111-1111-4111-8111-111111111111";


async function createIncident(page: Page, title: string): Promise<string> {
	const created = await page.request.post("/api/incidents", {
		data: { title },
	});
	expect(created.ok()).toBeTruthy();
	const incident: { id: string } = await created.json();
	return incident.id;
}

test.describe("#743 — the incident page, its run strip and its routes", () => {
	test.beforeEach(({ page }) => hideQueryDevtools(page));

	test("cards, strip, report and conversation for a completed run", async ({
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

		// The run strip speaks the run's words, not the incident's.
		await expect(page.getByTestId("run-strip-state")).toHaveText("Done");
		await expect(page.getByTestId("run-stop")).toHaveCount(0);

		// The sections, in the order an SRE asks; the facts in the rail.
		const ids = [
			"incident-summary",
			"overview-report",
			"overview-alerts",
			"overview-timeline",
		];
		const ys: number[] = [];
		for (const id of ids) {
			const box = await page.getByTestId(id).boundingBox();
			expect(box, `${id} has a bounding box`).not.toBeNull();
			ys.push(box?.y ?? 0);
		}
		for (let i = 1; i < ys.length; i++) {
			expect(ys[i], `${ids[i]} sits below ${ids[i - 1]}`).toBeGreaterThan(
				ys[i - 1],
			);
		}

		// The rail reads the service's telemetry, never a fixed line (walk f15).
		await expect(page.getByTestId("facts-rail")).toBeVisible();
		await expect(page.getByTestId("fact-telemetry")).not.toContainText(
			"Metrics not connected",
		);

		// A note goes to the timeline from the Timeline section's own field.
		const note = `Design evidence note ${Date.now()}`;
		await page.getByTestId("note-input").fill(note);
		await page.getByTestId("note-input").press("Enter");
		await expect(page.getByTestId("overview-timeline")).toContainText(note);

		// The box docked at the bottom briefs the next run once this one ended.
		await expect(page.getByTestId("composer-investigate")).toHaveText(
			"Investigate again",
		);

		await settled(page);

		// The Report heading opens the report, band and strip still pinned.
		await page.getByTestId("overview-report-heading").click();
		await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}\/report/);
		await expect(page.getByTestId("report-route")).toBeVisible();
		await expect(page.getByTestId("report-answer")).toBeVisible();
		await expect(page.getByTestId("do-now")).toBeVisible();
		await expect(page.getByTestId("run-strip")).toBeVisible();
		await expect(page.getByTestId("record-tabs")).toBeVisible();

		// Esc goes back to the incident.
		await page.locator("body").press("Escape");
		await expect(page.getByTestId("incident-record")).toBeVisible();
		await expect(page).not.toHaveURL(/\/report/);

		// The conversation: prose, the tool call folded to one line, the end.
		await page.getByTestId("tab-conversation").click();
		await expect(page.getByTestId("conversation-route")).toBeVisible();
		const transcript = page.getByTestId("transcript");
		await expect(transcript.getByTestId("transcript-prose")).toHaveText(
			"Mapping the connection pool",
		);
		await expect(transcript.getByTestId("transcript-tools")).toContainText(
			"Ran 1 tool",
		);
		await expect(transcript).toContainText("Finished: submitted");

		// The Ledger view is the row-per-event panel, one row per event.
		await page.getByTestId("conversation-view-ledger").click();
		const panel = page.getByTestId("investigation-stream-panel");
		await expect(panel.getByTestId("stream-event-row")).toHaveCount(3);
		await page.getByTestId("conversation-view-transcript").click();

		await settled(page);

		await setTheme(page, "dark");
		await expect(page.getByTestId("conversation-route")).toBeVisible();
		await settled(page);
	});

	test("the incident tabs: every tab in place, and Esc walks back to the board", async ({
		page,
	}) => {
		await page.goto(`/incidents/${INCIDENT_ID}/alerts`);
		await expect(page.getByTestId("alerts-route")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("incident-state-band")).toBeVisible();
		await expect(page.getByTestId("run-strip")).toBeVisible();

		await page.getByTestId("tab-timeline").click();
		await expect(page.getByTestId("timeline-route")).toBeVisible();
		await expect(page.getByTestId("note-field")).toBeVisible();

		await page.getByTestId("tab-conversation").click();
		await expect(page.getByTestId("conversation-route")).toBeVisible();

		// Esc is ignored while typing, and goes back once the field lets go.
		await page.getByTestId("composer-input").focus();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("conversation-route")).toBeVisible();
		await page.getByTestId("composer-input").blur();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("incident-record")).toBeVisible();

		// From Overview, Esc and the back arrow both reach the board.
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("incident-board")).toBeVisible();
		await page.goto(`/incidents/${INCIDENT_ID}`);
		await page.getByRole("link", { name: "Back to the board" }).click();
		await expect(page.getByTestId("incident-board")).toBeVisible();

		// An old investigation link lands on the conversation.
		await page.goto(`/investigations/${INVESTIGATION_ID}`);
		await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}\/conversation/, {
			timeout: 15_000,
		});
	});

	test("empty — an incident with no run", async ({ page }) => {
		const id = await createIncident(page, `No investigation yet ${Date.now()}`);

		await page.goto(`/incidents/${id}`);
		await expect(page.getByTestId("overview-report")).toContainText(
			"No investigation yet",
			{ timeout: 15_000 },
		);
		await setTheme(page, "light");
		await expect(page.getByTestId("run-strip")).toHaveCount(0);
		await expect(page.getByTestId("composer-investigate")).toHaveText(
			"Investigate",
		);
		await settled(page);
	});

	test("error — a failed run", async ({ page }) => {
		await serveInvestigationAs(page, INVESTIGATION_ID, {
			status: "failed",
			error: "harness lost the tool socket",
		});

		await page.goto(`/incidents/${INCIDENT_ID}`);
		await expect(page.getByTestId("run-strip-state")).toHaveText("Failed", {
			timeout: 15_000,
		});
		await expect(page.getByTestId("overview-report")).toContainText(
			"harness lost the tool socket",
		);
		await setTheme(page, "light");
		await settled(page);

		await page.getByTestId("tab-conversation").click();
		await expect(page.getByTestId("transcript-end")).toContainText(
			"Failed: harness lost the tool socket",
		);
		await page.getByTestId("conversation-view-ledger").click();
		await expect(page.getByTestId("investigation-failed-state")).toBeVisible();
	});

	test("a live run: Stop asks first, then reads Stopping", async ({ page }) => {
		await installStreamDouble(page);
		await serveAsRunning(page, INVESTIGATION_ID);
		// The run heard the cancel: the API answers with the still-running row.
		const seeded = await page.request.get(
			`/api/investigations/${INVESTIGATION_ID}`,
		);
		const running = { ...(await seeded.json()), status: "running" };
		let cancelled = 0;
		await page.route(
			(url) =>
				url.pathname === `/api/investigations/${INVESTIGATION_ID}/cancel`,
			async (route) => {
				cancelled++;
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(running),
				});
			},
		);

		await page.goto(`/incidents/${INCIDENT_ID}`);
		const state = page.getByTestId("run-strip-state");
		await expect(state).toHaveText("Starting", { timeout: 15_000 });

		const events = eventFactory("run");
		await deliver(page, events.agentStep("", "Reading the gateway logs"));
		await expect(state).toHaveText("Working");
		await expect(page.getByTestId("incident-summary")).toContainText(
			"An investigation is working now",
		);
		await expect(page.getByTestId("overview-report")).toContainText(
			"The report comes when the run finishes",
		);

		// Keep going closes the confirm and sends nothing.
		await page.getByTestId("run-stop").click();
		const confirm = page.getByTestId("run-stop-confirm");
		await expect(confirm).toContainText("Stop this investigation?");
		await confirm.getByRole("button", { name: "Keep going" }).click();
		await expect(confirm).toHaveCount(0);
		expect(cancelled).toBe(0);

		await page.getByTestId("run-stop").click();
		await page.getByTestId("run-stop-confirm-button").click();
		await expect.poll(() => cancelled).toBe(1);
		await expect(state).toHaveText("Stopping");
		await expect(page.getByTestId("run-stop")).toBeDisabled();
		await expect(page.getByTestId("run-stop")).toHaveText("Stopping");
		await page.unrouteAll({ behavior: "ignoreErrors" });
	});

	test("a live run: Enter queues a message, a closed run offers Save as note", async ({
		page,
	}) => {
		await installStreamDouble(page);
		await serveAsRunning(page, INVESTIGATION_ID);
		const sent: Record<string, unknown>[] = [];
		let answer: "queued" | "conflict" = "queued";
		await page.route(
			(url) =>
				url.pathname === `/api/investigations/${INVESTIGATION_ID}/messages`,
			async (route) => {
				sent.push(route.request().postDataJSON() as Record<string, unknown>);
				if (answer === "conflict") {
					await route.fulfill({
						status: 409,
						contentType: "application/json",
						body: JSON.stringify({
							defined: false,
							code: "CONFLICT",
							status: 409,
							message: "The run is not live",
						}),
					});
					return;
				}
				await route.fulfill({
					status: 202,
					contentType: "application/json",
					body: JSON.stringify({ state: "queued" }),
				});
			},
		);

		await page.goto(`/incidents/${INCIDENT_ID}/conversation`);
		await expect(page.getByTestId("conversation-route")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("run-strip-state")).toHaveText("Starting");
		await deliver(page, eventFactory("run").agentStep("", "Reading the logs"));
		await expect(page.getByTestId("transcript-prose")).toHaveText(
			"Reading the logs",
		);

		// Live mode: the agent is fixed for this run; Enter queues.
		const input = page.getByTestId("composer-input");
		await expect(page.getByTestId("agent-chip")).toBeVisible();
		await input.fill("Check the deploy at 13:58 first.");
		await expect(page.getByTestId("composer-hint")).toContainText(
			"queue until the agent pauses",
		);
		await input.press("Enter");
		await expect.poll(() => sent.length).toBe(1);
		expect(sent[0]).toMatchObject({
			text: "Check the deploy at 13:58 first.",
			mode: "queue",
		});
		await expect(page.getByTestId("transcript-operator")).toHaveAttribute(
			"data-state",
			"queued",
		);
		await expect(page.getByTestId("composer-waiting")).toHaveText("1 waiting");

		// Ctrl+Enter sends now; the run has ended, so the API answers 409.
		answer = "conflict";
		await input.fill("Also check the TTL.");
		await input.press("Control+Enter");
		await expect.poll(() => sent.length).toBe(2);
		expect(sent[1]).toMatchObject({ mode: "now" });
		const undeliverable = page.getByTestId("composer-undeliverable");
		await expect(undeliverable).toContainText(
			"The investigation ended before your message reached it.",
		);
		await expect(
			page.locator(
				'[data-testid="transcript-operator"][data-state="not_delivered"]',
			),
		).toHaveCount(1);
		await expect(
			undeliverable.getByRole("button", { name: "Save as note" }),
		).toBeVisible();
		await page.unrouteAll({ behavior: "ignoreErrors" });
	});
});
