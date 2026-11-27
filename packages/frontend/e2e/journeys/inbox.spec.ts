// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Locator, type Page } from "@playwright/test";
import { fingerprintOf } from "../../../../scripts/fakes/fake-alertmanager.mjs";
import { test } from "../steps/fixtures";
import {
	detail,
	ensureService,
	fireIncident,
	LIVE,
	QUIET,
	readableTitle,
	resolveIncident,
	visit,
	waitFor,
	waitForRun,
} from "../steps/product";

/** One incident fires harder than an hour ago to trigger the 'worse' status */
async function worsen(page: Page, title: string) {
	await page.route("**/api/incidents?**", async (route) => {
		const res = await route.fetch();
		const body = await res.json();
		for (const i of body.data ?? []) {
			if (i.title !== title || !i.alerts?.length) continue;
			const first = i.alerts[0];
			first.triggeredAt = new Date(Date.now() - 6 * 3_600_000).toISOString();
			i.alerts.push({
				...first,
				id: crypto.randomUUID(),
				triggeredAt: new Date(Date.now() - 12 * 60_000).toISOString(),
			});
			i.alertCount = i.alerts.length;
		}
		await route.fulfill({ response: res, json: body });
	});
}

/** One incident's card in its group; the filter keeps it inside the group's first six (#1154). */
async function inboxRow(page: Page, need: string, title: string) {
	await page.getByTestId("incidents-filter").fill(title);
	return page
		.locator(`[data-testid="needs-group"][data-need="${need}"]`)
		.getByTestId("inbox-row")
		.filter({ hasText: readableTitle(title) });
}

/** A card's ⋯ menu, opened; the trigger shows on hover. */
async function rowMenu(page: Page, row: Locator, title: string) {
	await row.hover();
	await row
		.getByRole("button", { name: `${readableTitle(title)} actions` })
		.click();
	return page.getByRole("menu");
}

test.describe("Inbox (PR #812, umbrella #811)", () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
	});

	test("Needs you groups and row actions: approval, ready, failed, stopped, nocause, cleared", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.slow();

		// 1. Approval run
		const approvalInc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("NeedsApproval"),
			service: QUIET,
			quiet: true,
			session: "ask",
		});
		await page.request.post(`/api/incidents/${approvalInc.id}/investigate`, {
			data: { accessLevel: "supervised" },
		});
		const approvalRun = await waitFor(async () => {
			const d = await detail(page, approvalInc.id);
			const r = d.investigations?.[0] as
				| { id: string; status: string; awaitingApprovalAt?: string }
				| undefined;
			return r?.awaitingApprovalAt ? r : undefined;
		}, "awaiting approval");

		// 2. Ready run (completed with rootCause)
		const readyInc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("FindingReady"),
			service: LIVE,
			session: "success",
		});
		await waitForRun(
			page,
			readyInc.id,
			(r) => r.status === "completed",
			"ready",
		);

		// 3. Failed run (not firing). The `failure` session's rejected key is a provider stop, Blocked (#1101).
		const failedInc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("RunFailed"),
			service: LIVE,
			session: "not-signed-in",
		});
		await waitForRun(
			page,
			failedInc.id,
			(r) => r.status === "failed",
			"failed",
		);
		const failedFp = fingerprintOf(failedInc.labels);
		alertmanager.clear(failedFp);
		await deliverWebhook([failedFp]);
		await page.request.patch(`/api/incidents/${failedInc.id}`, {
			data: { status: "investigating" },
		});

		const blockedInc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("RunBlocked"),
			service: LIVE,
			session: "failure",
		});
		await waitForRun(
			page,
			blockedInc.id,
			(r) => r.status === "failed",
			"blocked",
		);

		// 4. Stopped run
		const stoppedInc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("RunStopped"),
			service: LIVE,
			session: "live",
		});
		const halt = await waitForRun(
			page,
			stoppedInc.id,
			(r) => r.status === "running",
			"running",
		);
		await page.request.post(`/api/investigations/${halt.id}/cancel`);
		await waitForRun(
			page,
			stoppedInc.id,
			(r) => r.status === "cancelled",
			"stopped",
		);

		// 5. Nocause runs (investigated without finding, and uninvestigated)
		const nocauseInc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("RunNoCause"),
			service: LIVE,
			session: "nocause",
		});
		await waitForRun(
			page,
			nocauseInc.id,
			(r) => r.status === "completed",
			"nocause",
		);

		const uninvestigatedInc = await fireIncident(
			page,
			alertmanager,
			deliverWebhook,
			{
				name: unique("Uninvestigated"),
				service: QUIET,
				quiet: true,
			},
		);

		// 6. Cleared alerts
		const clearedInc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("AlertsCleared"),
			service: QUIET,
			quiet: true,
		});
		const clearedFp = fingerprintOf(clearedInc.labels);
		alertmanager.clear(clearedFp);
		await deliverWebhook([clearedFp]);
		await waitFor(
			async () =>
				(await detail(page, clearedInc.id)).status === "resolved"
					? true
					: undefined,
			"cleared",
		);

		await visit(page, "/incidents");
		await expect(page.getByTestId("needs-you")).toBeVisible({
			timeout: 15_000,
		});

		// Approval leads; a card whose next step is the run itself has no button: its title opens it.
		await expect(page.getByTestId("needs-group").first()).toHaveAttribute(
			"data-need",
			"approval",
		);
		const approvalRow = await inboxRow(page, "approval", approvalInc.title);
		await expect(approvalRow.getByTestId("inbox-row-reason")).toContainText(
			"Waiting:",
		);
		await expect(approvalRow.getByTestId("inbox-row-action")).toHaveCount(0);
		await approvalRow.getByTestId("inbox-row-title").click();
		await expect(page).toHaveURL(
			new RegExp(`(investigations/|investigation=)${approvalRun.id}`),
		);

		await visit(page, "/incidents");
		const readyRow = await inboxRow(page, "ready", readyInc.title);
		await expect(readyRow.getByTestId("inbox-row-reason")).toContainText(
			"Likely:",
		);
		await expect(readyRow.getByTestId("inbox-row-action")).toHaveCount(0);

		// A failed run that no longer fires: Retry run on the card, Resolve in its ⋯ menu.
		const failedRow = await inboxRow(page, "failed", failedInc.title);
		await expect(failedRow.getByTestId("inbox-row-reason")).toContainText(
			"Failed:",
		);
		await expect(failedRow.getByTestId("inbox-row-action")).toHaveText(
			"Retry run",
		);
		await expect(await rowMenu(page, failedRow, failedInc.title)).toContainText(
			"Resolve",
		);
		await page.keyboard.press("Escape");

		// A provider stop waits in its own group; the thread's dock holds its fix, so the card opens it.
		const blockedRow = await inboxRow(page, "blocked", blockedInc.title);
		await expect(blockedRow.getByTestId("inbox-row-reason")).toContainText(
			"Blocked:",
		);
		await expect(blockedRow.getByTestId("inbox-row-action")).toHaveCount(0);

		const stoppedRow = await inboxRow(page, "failed", stoppedInc.title);
		await expect(stoppedRow.getByTestId("inbox-row-reason")).toContainText(
			"Stopped by you",
		);
		await expect(stoppedRow.getByTestId("inbox-row-action")).toHaveText(
			"Retry run",
		);

		const nocauseRow = await inboxRow(page, "nocause", nocauseInc.title);
		await expect(nocauseRow.getByTestId("inbox-row-action")).toHaveText(
			"Investigate again",
		);
		const uninvRow = await inboxRow(
			page,
			"uninvestigated",
			uninvestigatedInc.title,
		);
		await expect(uninvRow.getByTestId("inbox-row-action")).toHaveText(
			"Investigate",
		);

		const clearedRow = await inboxRow(page, "cleared", clearedInc.title);
		await expect(clearedRow.getByTestId("inbox-row-action")).toHaveText(
			"Resolve",
		);
		await clearedRow.getByTestId("inbox-row-action").click();
		await expect(page.getByTestId("resolve-dialog")).toBeVisible();
		await page.keyboard.press("Escape");
	});

	test("needs-more expands when more than 6 rows are in a group", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.slow();
		const prefix = unique("MoreRow");
		for (let i = 0; i < 7; i++) {
			await fireIncident(page, alertmanager, deliverWebhook, {
				name: `${prefix}-${i}`,
				service: QUIET,
				quiet: true,
			});
		}

		await visit(page, "/incidents");
		const nocauseGroup = page.locator(
			'[data-testid="needs-group"][data-need="uninvestigated"]',
		);
		await expect(nocauseGroup).toBeVisible({ timeout: 15_000 });

		const moreButton = nocauseGroup.getByTestId("needs-more");
		await expect(moreButton).toBeVisible();
		await expect(moreButton).toContainText(/Show \d+ more/);
		await expect(nocauseGroup.getByTestId("inbox-row")).toHaveCount(6);

		await moreButton.click();
		await expect(moreButton).toHaveCount(0);
		expect(
			await nocauseGroup.getByTestId("inbox-row").count(),
		).toBeGreaterThanOrEqual(7);
	});

	test("group filter and search text filter narrow rows and Recently resolved", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.slow();
		const incA = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("AlphaQueryIncident"),
			service: LIVE,
			session: "success",
		});
		await waitForRun(page, incA.id, (r) => r.status === "completed", "ready");

		const incB = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("BetaNocauseIncident"),
			service: QUIET,
			quiet: true,
		});

		const closedInc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("GammaClosedIncident"),
			service: QUIET,
			quiet: true,
		});
		await resolveIncident(page, closedInc.id);

		await visit(page, "/incidents");
		await expect(page.getByTestId("needs-you")).toBeVisible({
			timeout: 15_000,
		});

		// Filter by group button
		const filterGroupBtn = page.getByTestId("needs-filter-ready");
		if ((await filterGroupBtn.count()) > 0) {
			await filterGroupBtn.click();
			await expect(
				page.locator('[data-testid="needs-group"][data-need="ready"]'),
			).toBeVisible();
			await expect(
				page.locator('[data-testid="needs-group"][data-need="uninvestigated"]'),
			).toHaveCount(0);
			await page.getByTestId("needs-filter-all").click();
			await expect(
				page.locator('[data-testid="needs-group"][data-need="uninvestigated"]'),
			).toBeVisible();
		}

		// Text filter narrows rows and recently resolved
		const filterInput = page.getByTestId("incidents-filter");
		await filterInput.fill("AlphaQuery");
		await expect(
			page
				.getByTestId("inbox-row")
				.filter({ hasText: readableTitle(incA.title) }),
		).toBeVisible();
		await expect(
			page.getByTestId("inbox-row").filter({ hasText: incB.title }),
		).toHaveCount(0);

		// Recently resolved also filtered
		await filterInput.fill("GammaClosed");
		const recentRow = page.getByTestId("recent-row");
		await expect(
			recentRow.filter({ hasText: readableTitle(closedInc.title) }),
		).toBeVisible();
		await filterInput.fill("NonExistentIncidentQuery");
		await expect(page.getByTestId("needs-empty")).toBeVisible();
		await expect(page.getByTestId("recent-row")).toHaveCount(0);
	});

	test("tiles: worse links to incident, alerts to /alerts, services to /services", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.slow();
		const worseInc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("WorseningIncident"),
			service: LIVE,
			session: "live",
		});
		await waitForRun(
			page,
			worseInc.id,
			(r) => r.status === "running",
			"running",
		);
		await worsen(page, worseInc.title);

		await visit(page, "/incidents");
		await expect(page.getByTestId("inbox-tiles")).toBeVisible({
			timeout: 15_000,
		});

		// inbox-tile-worse
		const tileWorse = page.getByTestId("inbox-tile-worse");
		await expect(tileWorse).toBeVisible();
		await expect(tileWorse).toHaveAttribute(
			"href",
			`/incidents/${worseInc.id}`,
		);

		// inbox-tile-alerts
		const tileAlerts = page.getByTestId("inbox-tile-alerts");
		await expect(tileAlerts).toBeVisible();
		await expect(tileAlerts).toHaveAttribute("href", "/alerts");

		// inbox-tile-services
		const tileServices = page.getByTestId("inbox-tile-services");
		await expect(tileServices).toBeVisible();
		await expect(tileServices).toHaveAttribute("href", "/services");

		await page.unrouteAll({ behavior: "ignoreErrors" });
	});

	test("no agent ready: inbox-tile-agent and inbox-setup show, linking to /settings?tab=agent", async ({
		page,
	}) => {
		// Stub harnesses endpoint to simulate no agent checked/ready
		await page.route("**/api/settings/harnesses*", async (route) => {
			const res = await route.fetch();
			const body = await res.json();
			for (const h of body.harnesses ?? []) h.checked = null;
			if (body.selection) body.selection.runnable = false;
			await route.fulfill({ response: res, json: body });
		});

		await visit(page, "/incidents");
		await expect(page.getByTestId("inbox-tile-agent")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("inbox-setup")).toBeVisible();

		const setupLink = page.getByTestId("inbox-setup-agent");
		await expect(setupLink).toHaveAttribute("href", "/settings?tab=agent");
		await setupLink.click();
		await expect(page).toHaveURL(/\/settings\?tab=agent/);

		await page.unrouteAll({ behavior: "ignoreErrors" });
	});

	test("recent-row lists closed incidents newest first, All incidents link goes to ?view=all&status=closed, all-row filters", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.slow();
		const closedA = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("FirstClosed"),
			service: QUIET,
			quiet: true,
		});
		await resolveIncident(page, closedA.id);

		await page.waitForTimeout(1_000);

		const closedB = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("SecondClosed"),
			service: QUIET,
			quiet: true,
		});
		await resolveIncident(page, closedB.id);

		await visit(page, "/incidents");
		const recentSection = page.getByTestId("recently-resolved");
		await expect(recentSection).toBeVisible({ timeout: 15_000 });

		const recentRows = recentSection.getByTestId("recent-row");
		await expect(recentRows.first()).toContainText(
			readableTitle(closedB.title),
		);
		await expect(recentRows.nth(1)).toContainText(readableTitle(closedA.title));

		// "All incidents" link inside Recently resolved
		const allLink = recentSection.getByRole("link", { name: "All incidents" });
		await expect(allLink).toBeVisible();
		await allLink.click();
		await expect(page).toHaveURL(/\/incidents\?.*view=all.*status=closed/);

		const allIncidents = page.getByTestId("all-incidents");
		await expect(allIncidents).toBeVisible();
		await expect(allIncidents.getByTestId("all-row").first()).toBeVisible();

		// Segmented status filter and severity filter
		await page.getByTestId("all-status-open").click();
		await page.getByTestId("all-status-all").click();
		await expect(page.getByTestId("all-severity")).toBeVisible();
	});

	test("sidebar thread list: one flat row per run with its status, no nesting, Search finds quiet incidents (#1020)", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.slow();
		await ensureService(page, {
			name: "tree-test-service",
			displayName: "Tree Test Service",
			trigger: "never",
		});

		// Nine quiet incidents and one with a finding: the finding is a thread in Recents; Search finds the quiet ones (#1020).
		const prefix = unique("TreeItem");
		const treeIncidents: { id: string; number: number; title: string }[] = [];
		for (let i = 0; i < 9; i++) {
			const inc = await fireIncident(page, alertmanager, deliverWebhook, {
				name: `${prefix}-${i}`,
				service: {
					name: "tree-test-service",
					displayName: "Tree Test Service",
				},
				quiet: true,
			});
			treeIncidents.push(inc);
		}

		// Also an incident with a run on LIVE service
		const liveRunInc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("TreeLiveRun"),
			service: LIVE,
			session: "success",
		});
		const completedRun = await waitForRun(
			page,
			liveRunInc.id,
			(r) => r.status === "completed",
			"completed run",
		);

		await visit(page, "/new");
		const tree = page.getByTestId("thread-list");
		await expect(tree).toBeVisible({ timeout: 15_000 });
		// One flat list (#1101 category 1): the run is a row of its own, under one section, with no children.
		const row = tree.locator(
			`[data-testid="thread-row"][data-id="${completedRun.id}"]`,
		);
		await expect(row).toHaveCount(1);
		await expect(row).toBeVisible();
		await expect(row).toHaveAttribute(
			"href",
			new RegExp(`/incidents/${liveRunInc.id}`),
		);
		// Its state is one status mark named by its word, never a fold (#1101 cat 1, cat 2).
		await expect(row.getByRole("img", { name: "Done" })).toBeVisible();
		await expect(row.getByTestId("row-status")).toHaveCount(0);
		await expect(tree.getByTestId("tree-toggle")).toHaveCount(0);
		await expect(
			tree.locator(
				treeIncidents
					.map((inc) => `a[href*="/incidents/${inc.id}"]`)
					.join(", "),
			),
		).toHaveCount(0);

		// A quiet incident has no run, so it is no thread: Search finds it by name (#1020).
		await page.getByTestId("nav-search").click();
		await page.getByTestId("thread-search-input").fill(prefix);
		await expect(page.getByTestId("thread-search-incident")).toHaveCount(8);
		await page.keyboard.press("Escape");

		// nav-settings at the foot of sidebar
		await expect(page.getByTestId("nav-settings")).toBeVisible();
	});

	test("reopens a resolved incident from the header behind confirm dialog", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		const inc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("ReopenFromBand"),
			service: QUIET,
			quiet: true,
		});
		await resolveIncident(page, inc.id);

		await visit(page, `/incidents/${inc.id}`);
		const reopenBtn = page.getByTestId("header-reopen");
		await expect(reopenBtn).toBeVisible({ timeout: 15_000 });
		await reopenBtn.click();

		const dialog = page.getByTestId("reopen-dialog");
		await expect(dialog).toBeVisible();
		await dialog.getByTestId("confirm-reopen-incident").click();

		await expect
			.poll(async () => {
				const d = await detail(page, inc.id);
				return d.status;
			})
			.toBe("investigating");
		// With no run, Resolve is no header button but the ⋯ menu's (#1101).
		await expect(page.getByTestId("header-reopen")).toHaveCount(0);
		await page.getByTestId("header-more").click();
		await expect(page.getByTestId("menu-resolve")).toBeVisible();
		await page.keyboard.press("Escape");
	});

	test("retrying a run from inbox row shows refusal toast when server rejects it", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		const inc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("RefusalProbe"),
			service: LIVE,
			// A plain failure: `failure`'s rejected key ends Blocked, whose card has no Retry (#1101).
			session: "not-signed-in",
		});
		await waitForRun(page, inc.id, (r) => r.status === "failed", "failed");

		await page.route(
			`**/api/incidents/${inc.id}/investigate`,
			async (route) => {
				await route.fulfill({
					status: 412,
					contentType: "application/json",
					body: JSON.stringify({
						defined: true,
						code: "PRECONDITION_FAILED",
						status: 412,
						message: "No coding agent on this machine.",
						data: {
							failure: "no-harness",
							reason: "No coding agent on this machine.",
						},
					}),
				});
			},
		);

		await visit(page, "/incidents");
		const row = await inboxRow(page, "failed", inc.title);
		await expect(row.getByTestId("inbox-row-action")).toHaveText("Retry run");
		await row.getByTestId("inbox-row-action").click();

		await expect(page.getByText("Investigation refused").first()).toBeVisible();
		await page.unrouteAll({ behavior: "ignoreErrors" });
	});
});
