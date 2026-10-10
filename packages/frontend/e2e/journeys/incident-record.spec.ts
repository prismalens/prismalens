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

		const header = page.getByTestId("incident-header");
		await expect(header).toBeVisible({ timeout: 15_000 });
		await expect(header).toContainText("INC-1");
		await expect(header.getByTestId("crumb-view")).toHaveText("Overview");
		await expect(header.getByTestId("header-severity")).toHaveText("Critical");
		await expect(
			header.getByRole("link", {
				name: "[demo] Storm: High 5xx error rate on API Gateway & Auth timeout",
			}),
		).toBeVisible();

		// Latest run strip under the header
		const strip = page.getByTestId("latest-run-strip");
		await expect(strip).toBeVisible();
		await expect(page.getByTestId("latest-run-link")).toContainText(
			"concluded",
		);
		await expect(page.getByTestId("latest-run-detail")).toContainText(
			"Likely cause found",
		);

		// The sections / cards on overview
		const cardIds = [
			"situation",
			"impact-card",
			"stop-impact-card",
			"why-card",
			"changes-card",
		];
		for (const id of cardIds) {
			await expect(page.getByTestId(id)).toBeVisible();
		}

		// A note from the composer lands in changes-timeline
		const note = `Design evidence note ${Date.now()}`;
		await page.getByTestId("action-chip").click();
		await page.getByTestId("action-note").click();
		await page.getByTestId("composer-input").fill(note);
		await page.getByTestId("composer-send").click();
		await expect(page.getByTestId("changes-timeline")).toContainText(note);

		await settled(page);

		// The latest run link opens the conversation
		await page.getByTestId("latest-run-link").click();
		await expect(page).toHaveURL(
			new RegExp(`/incidents/${INCIDENT_ID}/conversation\\?investigation=`),
		);
		await expect(page.getByTestId("run-page")).toBeVisible();
		const transcript = page.getByTestId("transcript");
		await expect(transcript.getByTestId("transcript-prose")).toHaveText(
			"Mapping the connection pool",
		);
		await expect(transcript.getByTestId("step").first()).toBeVisible();

		// The run's facts sit in the run strip under the header; there is no Event log.
		await expect(page.getByTestId("run-strip-label")).toHaveText(/concluded$/);
		await expect(page.getByRole("link", { name: "Event log" })).toHaveCount(0);

		await settled(page);

		await setTheme(page, "dark");
		await expect(page.getByTestId("run-page")).toBeVisible();
		await settled(page);
	});

	test("the incident tabs: old routes redirect to overview, and chevron returns to inbox", async ({
		page,
	}) => {
		await page.goto(`/incidents/${INCIDENT_ID}/alerts`);
		await expect(page).toHaveURL(new RegExp(`/incidents/${INCIDENT_ID}$`));
		await expect(page.getByTestId("incident-overview")).toBeVisible({
			timeout: 15_000,
		});

		await page.goto(`/incidents/${INCIDENT_ID}/timeline`);
		await expect(page).toHaveURL(new RegExp(`/incidents/${INCIDENT_ID}$`));
		await expect(page.getByTestId("incident-overview")).toBeVisible();

		// Back chevron in the header returns to the inbox
		await page.getByTestId("incident-back").click();
		await expect(page).toHaveURL(/\/incidents$/);
		await expect(page.getByTestId("inbox")).toBeVisible();
		await settled(page);
	});

	test("empty — an incident with no run", async ({ page }) => {
		const id = await createIncident(page, `No investigation yet ${Date.now()}`);

		await page.goto(`/incidents/${id}`);
		await expect(page.getByTestId("latest-run-strip")).toContainText(
			"No run yet",
			{ timeout: 15_000 },
		);
		await expect(page.getByTestId("why-none")).toBeVisible();
		await expect(page.getByTestId("fix-none")).toBeVisible();
		await setTheme(page, "light");

		// Navigating to Conversation opens on the draft
		await page.goto(`/incidents/${id}/conversation`);
		await expect(page.getByTestId("crumb-view")).toHaveText("New conversation");
		await expect(page.getByTestId("action-chip")).toHaveText("Ask");
		await expect(await investigateButton(page)).toBeVisible();
		await settled(page);
	});

	test("error — a failed run", async ({ page }) => {
		await serveInvestigationAs(page, INVESTIGATION_ID, {
			status: "failed",
			error: "harness lost the tool socket",
			hasReport: false,
		});
		await page.route(
			(url) => url.pathname === `/api/incidents/${INCIDENT_ID}`,
			async (route) => {
				const res = await route.fetch();
				const json = await res.json();
				if (json.investigations?.[0]) {
					json.investigations[0].status = "failed";
					json.investigations[0].error = "harness lost the tool socket";
					json.investigations[0].hasReport = false;
				}
				await route.fulfill({ json });
			},
		);

		await page.goto(`/incidents/${INCIDENT_ID}`);
		await expect(page.getByTestId("latest-run-strip")).toContainText(
			"harness lost the tool socket",
			{ timeout: 15_000 },
		);
		await expect(page.getByTestId("why-failed")).toBeVisible();
		await setTheme(page, "light");
		await settled(page);

		await page.goto(
			`/incidents/${INCIDENT_ID}/conversation?investigation=${INVESTIGATION_ID}`,
		);
		await expect(page.getByTestId("transcript-end")).toContainText(
			'Run failed: OpenCode answered "harness lost the tool socket".',
		);
		await expect(page.getByTestId("run-strip-label")).toHaveText(/failed$/);
	});

	test("a live run: Stop in the box ends it at once, then reads Stopping", async ({
		page,
	}) => {
		await installStreamDouble(page);
		await serveAsRunning(page, INVESTIGATION_ID);
		await page.route(
			(url) => url.pathname === `/api/incidents/${INCIDENT_ID}`,
			async (route) => {
				const res = await route.fetch();
				const json = await res.json();
				if (json.investigations?.[0]) {
					json.investigations[0].status = "running";
				}
				await route.fulfill({ json });
			},
		);
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
		await expect(page.getByTestId("latest-run-strip")).toContainText(
			"investigating",
			{ timeout: 15_000 },
		);
		await expect(page.getByTestId("why-live")).toBeVisible();

		// Clicking Watch on why-live opens the conversation
		await page.getByTestId("why-live").click();
		const state = page.getByTestId("run-strip-label");
		await expect(state).toHaveText(/starting$/, { timeout: 15_000 });

		const events = eventFactory("run");
		await deliver(page, events.agentStep("", "Reading the gateway logs"));
		await expect(state).toHaveText(/investigating$/);

		// No confirm: a stop is the harness's own cancel (R4.4).
		await page.getByTestId("run-strip-stop").click();
		await expect.poll(() => cancelled).toBe(1);
		await expect(state).toHaveText(/stopping$/);
		await expect(page.getByTestId("run-strip-stop")).toBeDisabled();
		await expect(page.getByTestId("run-strip-stop")).toHaveText("Stopping");
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
		await expect(page.getByTestId("run-page")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("run-strip-label")).toHaveText(/starting$/);
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
