// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

/**
 * J17 / C10 — manual authorship.
 *
 * The journey a `pl up` user has when nothing is wired up yet: author an
 * incident by hand from `/incidents`, then investigate it from its detail
 * page. This is the first spec in the suite that drives a *write* path on the
 * incidents surface — `incidents.create` followed by `incidents.investigate`.
 *
 * The harness precondition is stubbed at the route level, not through the
 * settings UI: it belongs to C6's gate, not to this journey, and there is no
 * settings write left to drive it through the API — a runnable harness is
 * detected from PATH, not configured (#337/#609).
 */
/** The shared gate's own words when `auto` resolves to nothing (#521). */
const NO_HARNESS_REASON =
	"the Claude Code CLI (claude) was not found on PATH — install the claude-code harness, or add an Anthropic API key in Settings → AI provider";

/** Hold the client gate open so a test can drive the server's refusal path. */
async function serveRunnableSelection(page: Page): Promise<void> {
	await page.route("**/api/settings/harnesses", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				harnesses: [],
				selection: {
					runnable: true,
					harness: "claude-code",
					blockedReason: null,
				},
			}),
		});
	});
}

test.describe("C10 — manual authorship without an alert source", () => {
	test("creates an incident by hand and starts an investigation from it", async ({
		page,
	}) => {
		const title = `Checkout latency spike ${Date.now()}`;

		// 0. Precondition: the gate reports a runnable harness (#520).
		await serveRunnableSelection(page);

		// 1. The incidents page offers the authorship affordance.
		await page.goto("/incidents");
		await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible({
			timeout: 15_000,
		});
		await page.getByTestId("create-incident-button").click();

		// 2. The form calls incidents.create and lands on the new incident.
		const dialog = page.getByTestId("create-incident-dialog");
		await expect(dialog).toBeVisible();
		await dialog.getByTestId("create-incident-title").fill(title);
		await dialog
			.getByTestId("create-incident-description")
			.fill("Authored by hand — no alert source is wired up.");
		await dialog.getByTestId("create-incident-submit").click();

		await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/, {
			timeout: 15_000,
		});
		await expect(page.getByRole("heading", { name: title })).toBeVisible({
			timeout: 15_000,
		});

		// 3. A hand-authored incident carries no alerts, and the UI says so
		//    rather than implying a correlation that never happened.
		await expect(page.getByRole("tab", { name: "Alerts (0)" })).toBeVisible();

		// 4. Start the investigation — incidents.investigate must accept an
		//    incident that has zero alerts.
		await page.getByRole("tab", { name: "Investigation" }).click();
		await expect(page.getByTestId("start-investigation")).toBeEnabled({
			timeout: 15_000,
		});
		await page.getByTestId("start-investigation").click();

		// 5. An investigation exists and the app routed to it.
		await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/, {
			timeout: 20_000,
		});
	});

	/**
	 * The server can still refuse a run the readiness gate reported as runnable —
	 * the gate reads settings, the run reaches the harness (#520, #531). Stub the
	 * client gate open and the investigate call refused, so the mismatch is
	 * reproducible without a real unrunnable harness, and assert the server's
	 * refusal reason actually renders — not just that the request 412s.
	 */
	test("surfaces the server's refusal reason when it refuses an investigation the client thinks is runnable", async ({
		page,
	}) => {
		await serveRunnableSelection(page);

		const refusalReason =
			"No runnable AI provider: the configured model has no credentials on this host.";
		await page.route("**/api/incidents/*/investigate", async (route) => {
			await route.fulfill({
				status: 412,
				contentType: "application/json",
				body: JSON.stringify({
					defined: true,
					code: "PRECONDITION_FAILED",
					status: 412,
					message: refusalReason,
					data: { failure: "llm-not-configured", reason: refusalReason },
				}),
			});
		});

		const created = await page.request.post("/api/incidents", {
			data: { title: `Refusal probe ${Date.now()}` },
		});
		expect(created.ok()).toBeTruthy();
		const incident: { id: string } = await created.json();

		await page.goto(`/incidents/${incident.id}`);
		await page.evaluate(() => {
			document.cookie = "prismalens-theme=light; path=/; max-age=31536000";
		});
		await page.reload();
		await expect(page.locator("html")).toHaveClass(/light/);
		await page.getByRole("tab", { name: "Investigation" }).click();

		// The client's own gate is open — this is the surface #531 fixes: a
		// server refusal the client didn't anticipate must not be a silent no-op.
		await expect(page.getByTestId("start-investigation")).toBeEnabled({
			timeout: 15_000,
		});
		await page.getByTestId("start-investigation").click();

		await expect(page.getByText(refusalReason).first()).toBeVisible({
			timeout: 15_000,
		});

		await page.waitForLoadState("networkidle");
		await page.screenshot({
			path: "e2e/journeys/screenshots/investigate-refusal-default.png",
			fullPage: true,
		});

		await page.evaluate(() => {
			document.cookie = "prismalens-theme=dark; path=/; max-age=31536000";
		});
		await page.reload();
		await expect(page.locator("html")).toHaveClass(/dark/);
		await page.getByRole("tab", { name: "Investigation" }).click();
		await expect(page.getByTestId("start-investigation")).toBeEnabled({
			timeout: 15_000,
		});
		await page.getByTestId("start-investigation").click();
		await expect(page.getByText(refusalReason).first()).toBeVisible({
			timeout: 15_000,
		});
		await page.waitForLoadState("networkidle");
		await page.screenshot({
			path: "e2e/journeys/screenshots/investigate-refusal-dark.png",
			fullPage: true,
		});
	});

	/**
	 * Design evidence for the frontend gate (AGENTS.md). Captures the changed
	 * surfaces in both themes plus the empty and error states, the same way
	 * #237's `single-origin.spec.ts` captures the artifact's.
	 */
	test("design evidence: both themes, the empty state, and the error state", async ({
		page,
	}) => {
		const shot = (name: string) =>
			page.screenshot({
				path: `e2e/journeys/screenshots/${name}.png`,
				fullPage: true,
			});

		// The dialog, light.
		await page.goto("/incidents");
		await page.evaluate(() => {
			document.cookie = "prismalens-theme=light; path=/; max-age=31536000";
		});
		await page.reload();
		await expect(page.locator("html")).toHaveClass(/light/);
		await page.getByTestId("create-incident-button").click();
		await expect(page.getByTestId("create-incident-dialog")).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot("create-incident-dialog-default");

		// The same dialog, dark.
		await page.evaluate(() => {
			document.cookie = "prismalens-theme=dark; path=/; max-age=31536000";
		});
		await page.reload();
		await expect(page.locator("html")).toHaveClass(/dark/);
		await page.getByTestId("create-incident-button").click();
		await expect(page.getByTestId("create-incident-dialog")).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot("create-incident-dialog-dark");

		// The error state: a create the API refuses is reported inside the
		// dialog, and the draft is left intact so it can be retried.
		await page.route("**/api/incidents", async (route) => {
			if (route.request().method() === "POST") {
				await route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({ message: "Internal server error" }),
				});
				return;
			}
			await route.fallback();
		});
		await page
			.getByTestId("create-incident-title")
			.fill("An incident the server refuses");
		await page.getByTestId("create-incident-submit").click();
		await expect(page.getByTestId("create-incident-error")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("create-incident-dialog")).toBeVisible();
		await shot("create-incident-error");
		await page.unroute("**/api/incidents");

		// The empty state — what a fresh install sees. The seeded database has
		// incidents, so a future `from` filter is what makes the table empty
		// deterministically.
		const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
		await page.goto(`/incidents?from=${encodeURIComponent(tomorrow)}`);
		await expect(page.getByTestId("incidents-empty-state")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("incidents-empty-create")).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot("incidents-empty");
	});

	/**
	 * The investigate gate, asserted without touching global state. Stubbing the
	 * settings response rather than clearing `activeProvider` keeps this
	 * independent of whatever the other tests have configured — and of whether
	 * this is a first run or a Playwright retry against the same database.
	 */
	test("offers no way to investigate while no harness is usable", async ({
		page,
	}) => {
		await page.route("**/api/settings/harnesses", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					harnesses: [],
					selection: {
						runnable: false,
						harness: null,
						blockedReason: NO_HARNESS_REASON,
					},
				}),
			});
		});

		const created = await page.request.post("/api/incidents", {
			data: { title: `Gate check ${Date.now()}` },
		});
		expect(created.ok()).toBeTruthy();
		const incident: { id: string } = await created.json();

		await page.goto(`/incidents/${incident.id}`);
		await page.getByRole("tab", { name: "Investigation" }).click();

		// Both affordances for the same procedure must agree that it is blocked,
		// and the gate's own words say why (#521).
		await expect(page.getByTestId("start-investigation")).toBeDisabled();
		await expect(page.getByText(NO_HARNESS_REASON).first()).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Investigate", exact: true }),
		).toBeDisabled();
	});

	test("cannot submit an incident with no title", async ({ page }) => {
		await page.goto("/incidents");
		await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible({
			timeout: 15_000,
		});
		await page.getByTestId("create-incident-button").click();

		const dialog = page.getByTestId("create-incident-dialog");
		await expect(dialog).toBeVisible();

		// Submit stays disabled until the one required field holds real text, so
		// the dialog cannot POST an incident the API would reject.
		await expect(dialog.getByTestId("create-incident-submit")).toBeDisabled();

		await dialog.getByTestId("create-incident-title").fill("   ");
		await expect(dialog.getByTestId("create-incident-submit")).toBeDisabled();

		await dialog.getByTestId("create-incident-title").fill("Has a title now");
		await expect(dialog.getByTestId("create-incident-submit")).toBeEnabled();
	});
});
