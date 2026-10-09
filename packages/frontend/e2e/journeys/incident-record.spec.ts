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
import { investigateButton } from "./verb";

/**
 * #743, #673 — the incident: a band that never scrolls, one reading column
 * with nothing beside it, the runs in the sidebar under the incident, the box
 * docked under the Conversation, and the routes one level down
 * (conversation, report, alerts, timeline).
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

test.describe("#743 — the incident page, its runs and its routes", () => {
	test.beforeEach(({ page }) => hideQueryDevtools(page));

	test("cards, runs, report and conversation for a completed run", async ({
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

		// The runs are the incident's children in the sidebar; Overview has no box.
		await expect(page.getByTestId("run-tree-row").first()).toBeVisible();
		await expect(page.getByTestId("docked-composer")).toHaveCount(0);

		// The sections, in the order an SRE asks, in one column.
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

		// A note goes to the timeline from the Timeline section's own field.
		const note = `Design evidence note ${Date.now()}`;
		await page.getByTestId("note-input").fill(note);
		await page.getByTestId("note-input").press("Enter");
		await expect(page.getByTestId("overview-timeline")).toContainText(note);

		// The next run starts from the band's menu, as a draft on Conversation.
		await page.getByTestId("band-more").click();
		await expect(page.getByTestId("band-menu-new-run")).toBeVisible();
		await page.keyboard.press("Escape");

		await settled(page);

		// The Report link opens the report, band and runs still in place.
		await page.getByTestId("overview-report-heading").click();
		await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}\/report/);
		await expect(page.getByTestId("report-route")).toBeVisible();
		await expect(page.getByTestId("report-answer")).toBeVisible();
		await expect(page.getByTestId("do-now")).toBeVisible();
		await expect(page.getByTestId("run-tree")).toBeVisible();
		await expect(page.getByTestId("record-tabs")).toBeVisible();

		// The conversation: prose, the tool call folded to one line, the end.
		await page.getByTestId("tab-conversation").click();
		await expect(page.getByTestId("conversation-route")).toBeVisible();
		const transcript = page.getByTestId("transcript");
		await expect(transcript.getByTestId("transcript-prose")).toHaveText(
			"Mapping the connection pool",
		);
		await expect(transcript.getByTestId("transcript-tools")).toBeVisible();

		// The run's facts sit in the status line under the box; there is no Event log.
		await expect(page.getByTestId("run-status-state")).toHaveText(/^Done/);
		await expect(page.getByRole("link", { name: "Event log" })).toHaveCount(0);

		await settled(page);

		await setTheme(page, "dark");
		await expect(page.getByTestId("conversation-route")).toBeVisible();
		await settled(page);
	});

	test("the incident tabs: every tab in place, and Esc is the chevron", async ({
		page,
	}) => {
		await page.goto(`/incidents/${INCIDENT_ID}/alerts`);
		await expect(page.getByTestId("alerts-route")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("incident-state-band")).toBeVisible();
		await expect(page.getByTestId("run-tree")).toBeVisible();

		await page.getByTestId("tab-timeline").click();
		await expect(page.getByTestId("timeline-route")).toBeVisible();
		await expect(page.getByTestId("note-field")).toBeVisible();

		// The seeded run kept no session, so the box to focus is a new run's draft.
		await page.getByTestId("band-more").click();
		await page.getByTestId("band-menu-new-run").click();
		await expect(page.getByTestId("conversation-route")).toBeVisible();

		// In the box Esc only lets go of it; once it has, Esc is the chevron.
		await page.getByTestId("composer-input").focus();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("conversation-route")).toBeVisible();
		await expect(page.getByTestId("composer-input")).not.toBeFocused();
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
			"No run yet. Start one with + New run.",
			{ timeout: 15_000 },
		);
		await setTheme(page, "light");
		await expect(page.getByTestId("run-tree-row")).toHaveCount(0);
		// With no run, Conversation opens on the draft.
		await page.getByTestId("tab-conversation").click();
		await expect(page.getByTestId("draft-heading")).toContainText("New run");
		await expect(await investigateButton(page)).toHaveText("Investigate");
		await settled(page);
	});

	test("error — a failed run", async ({ page }) => {
		await serveInvestigationAs(page, INVESTIGATION_ID, {
			status: "failed",
			error: "harness lost the tool socket",
		});

		await page.goto(`/incidents/${INCIDENT_ID}`);
		await expect(page.getByTestId("overview-report")).toContainText(
			"Run failed",
			{ timeout: 15_000 },
		);
		await expect(page.getByTestId("overview-report")).toContainText(
			"harness lost the tool socket",
		);
		await setTheme(page, "light");
		await settled(page);

		await page.getByTestId("tab-conversation").click();
		await expect(page.getByTestId("transcript-end")).toContainText(
			'Run failed: OpenCode answered "harness lost the tool socket".',
		);
		await expect(page.getByTestId("run-status-state")).toHaveText(/^Failed/);
	});

	test("a live run: Stop in the box ends it at once, then reads Stopping", async ({
		page,
	}) => {
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
		// The seeded live run carries a report: the pool keeps it open (#673 w59).
		await expect(page.getByTestId("overview-report")).toContainText("Likely", {
			timeout: 15_000,
		});
		await expect(page.getByTestId("incident-summary")).toContainText(
			"An investigation is working now",
		);
		await page.getByTestId("overview-open-conversation").click();
		const state = page.getByTestId("run-status-state");
		await expect(state).toHaveText(/^Starting/, { timeout: 15_000 });

		const events = eventFactory("run");
		await deliver(page, events.agentStep("", "Reading the gateway logs"));
		await expect(state).toHaveText(/^Working/);

		// No confirm: a stop is the harness's own cancel (R4.4).
		await page.getByTestId("composer-stop").click();
		await expect.poll(() => cancelled).toBe(1);
		await expect(state).toHaveText(/^Stopping/);
		await expect(page.getByTestId("composer-stop")).toBeDisabled();
		await expect(page.getByTestId("composer-stop")).toHaveText("Stopping");
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
		await expect(page.getByTestId("run-status-state")).toHaveText(/^Starting/);
		await deliver(page, eventFactory("run").agentStep("", "Reading the logs"));
		await expect(page.getByTestId("transcript-prose")).toHaveText(
			"Reading the logs",
		);

		// Live mode: the agent is fixed for this run; Enter queues.
		const input = page.getByTestId("composer-input");
		await expect(page.getByTestId("agent-picker")).toBeVisible();
		await input.fill("Check the deploy at 13:58 first.");
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
			"The run ended before your message reached it.",
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
