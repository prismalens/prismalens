// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import { fingerprintOf } from "../../../../scripts/fakes/fake-alertmanager.mjs";
import { test } from "../steps/fixtures";
import {
	acknowledge,
	detail,
	ensureService,
	fireIncident,
	LIVE,
	QUIET,
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

		// Configure supervised harness so fake-session:ask enters awaiting approval
		await page.request.patch("/api/settings/harness", {
			data: {
				autoAccessLevels: {
					opencode: "supervised",
					"claude-code": "supervised",
					codex: "supervised",
				},
			},
		});

		// 1. Approval run
		const approvalInc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("NeedsApproval"),
			service: LIVE,
			session: "ask",
		});
		const approvalRun = await waitFor(async () => {
			const d = await detail(page, approvalInc.id);
			const r = d.investigations?.[0] as
				| { id: string; status: string; awaitingApprovalAt?: string }
				| undefined;
			return r && r.awaitingApprovalAt ? r : undefined;
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

		// 3. Failed run (not firing)
		const failedInc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("RunFailed"),
			service: LIVE,
			session: "failure",
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
		const needsYou = page.getByTestId("needs-you");
		await expect(needsYou).toBeVisible({ timeout: 15_000 });

		// Approval group shows first
		const firstGroup = page.getByTestId("needs-group").first();
		await expect(firstGroup).toHaveAttribute("data-need", "approval");
		const approvalRow = firstGroup
			.getByTestId("inbox-row")
			.filter({ hasText: approvalInc.title });
		await expect(approvalRow).toBeVisible();
		const approvalAction = approvalRow.getByTestId("inbox-row-action");
		await expect(approvalAction).toHaveText("Open");
		await approvalAction.click();
		await expect(page).toHaveURL(
			new RegExp(`(investigations/|investigation=)${approvalRun.id}`),
		);

		// Navigate back to inbox
		await visit(page, "/incidents");

		// Ready group shows "Likely:"
		const readyGroup = page.locator(
			'[data-testid="needs-group"][data-need="ready"]',
		);
		await expect(readyGroup).toBeVisible();
		const readyRow = readyGroup
			.getByTestId("inbox-row")
			.filter({ hasText: readyInc.title });
		await expect(readyRow.getByTestId("inbox-row-reason")).toContainText(
			"Likely:",
		);

		// Failed group shows "Failed:", Retry run, and Resolve secondary action
		const failedGroup = page.locator(
			'[data-testid="needs-group"][data-need="failed"]',
		);
		await expect(failedGroup).toBeVisible();
		const failedRow = failedGroup
			.getByTestId("inbox-row")
			.filter({ hasText: failedInc.title });
		await expect(failedRow.getByTestId("inbox-row-reason")).toContainText(
			"Failed:",
		);
		await expect(failedRow.getByTestId("inbox-row-action")).toHaveText(
			"Retry run",
		);
		await expect(failedRow.getByTestId("inbox-row-secondary")).toHaveText(
			"Resolve",
		);

		// Stopped row shows "Stopped by you"
		const stoppedRow = failedGroup
			.getByTestId("inbox-row")
			.filter({ hasText: stoppedInc.title });
		await expect(stoppedRow.getByTestId("inbox-row-reason")).toContainText(
			"Stopped by you",
		);
		await expect(stoppedRow.getByTestId("inbox-row-secondary")).toHaveCount(0);

		// Nocause group: investigated shows "Investigate again", uninvestigated shows "Investigate"
		const nocauseGroup = page.locator(
			'[data-testid="needs-group"][data-need="nocause"]',
		);
		await expect(nocauseGroup).toBeVisible();
		const nocauseRow = nocauseGroup
			.getByTestId("inbox-row")
			.filter({ hasText: nocauseInc.title });
		await expect(nocauseRow.getByTestId("inbox-row-action")).toHaveText(
			"Investigate again",
		);

		const uninvRow = nocauseGroup
			.getByTestId("inbox-row")
			.filter({ hasText: uninvestigatedInc.title });
		await expect(uninvRow.getByTestId("inbox-row-action")).toHaveText(
			"Investigate",
		);

		// Cleared group shows "Resolve" which opens resolve dialog
		const clearedGroup = page.locator(
			'[data-testid="needs-group"][data-need="cleared"]',
		);
		await expect(clearedGroup).toBeVisible();
		const clearedRow = clearedGroup
			.getByTestId("inbox-row")
			.filter({ hasText: clearedInc.title });
		await expect(clearedRow.getByTestId("inbox-row-action")).toHaveText(
			"Resolve",
		);
		await clearedRow.getByTestId("inbox-row-action").click();
		const resolveDialog = page.getByTestId("resolve-dialog");
		await expect(resolveDialog).toBeVisible();
		await page.keyboard.press("Escape");
	});

	test("needs-more expands when more than 5 rows are in a group", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.slow();
		const prefix = unique("MoreRow");
		for (let i = 0; i < 6; i++) {
			await fireIncident(page, alertmanager, deliverWebhook, {
				name: `${prefix}-${i}`,
				service: QUIET,
				quiet: true,
			});
		}

		await visit(page, "/incidents");
		const nocauseGroup = page.locator(
			'[data-testid="needs-group"][data-need="nocause"]',
		);
		await expect(nocauseGroup).toBeVisible({ timeout: 15_000 });

		const moreButton = nocauseGroup.getByTestId("needs-more");
		await expect(moreButton).toBeVisible();
		await expect(moreButton).toContainText(/Show \d+ more/);
		expect(await nocauseGroup.getByTestId("inbox-row").count()).toBe(5);

		await moreButton.click();
		await expect(moreButton).toHaveCount(0);
		expect(
			await nocauseGroup.getByTestId("inbox-row").count(),
		).toBeGreaterThanOrEqual(6);
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
				page.locator('[data-testid="needs-group"][data-need="nocause"]'),
			).toHaveCount(0);
			await page.getByTestId("needs-filter-all").click();
			await expect(
				page.locator('[data-testid="needs-group"][data-need="nocause"]'),
			).toBeVisible();
		}

		// Text filter narrows rows and recently resolved
		const filterInput = page.getByTestId("incidents-filter");
		await filterInput.fill("AlphaQuery");
		await expect(
			page.getByTestId("inbox-row").filter({ hasText: incA.title }),
		).toBeVisible();
		await expect(
			page.getByTestId("inbox-row").filter({ hasText: incB.title }),
		).toHaveCount(0);

		// Recently resolved also filtered
		await filterInput.fill("GammaClosed");
		const recentRow = page.getByTestId("recent-row");
		await expect(recentRow.filter({ hasText: closedInc.title })).toBeVisible();
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

	test("no agent ready: inbox-tile-agent and inbox-setup show, linking to /settings?tab=harness", async ({
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
		await expect(setupLink).toHaveAttribute("href", "/settings?tab=harness");
		await setupLink.click();
		await expect(page).toHaveURL(/\/settings\?tab=harness/);

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
		await expect(recentRows.first()).toContainText(closedB.title);
		await expect(recentRows.nth(1)).toContainText(closedA.title);

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

	test("sidebar IncidentTree: data-health, tree-toggle, tree-run, tree-more, nav-incidents-count, nav-settings", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.slow();
		const serviceId = await ensureService(page, {
			name: "tree-test-service",
			displayName: "Tree Test Service",
			trigger: "never",
		});

		// Seed 9 incidents on the same service to exercise tree-more (cap is 8)
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

		await visit(page, "/incidents");
		const tree = page.getByTestId("incident-tree");
		await expect(tree).toBeVisible({ timeout: 15_000 });

		// Service item with data-health
		const serviceSection = page
			.getByTestId("tree-service")
			.filter({ hasText: "Tree Test Service" });
		await expect(serviceSection).toBeVisible();
		await expect(serviceSection.locator("[data-health]")).toBeVisible();

		// tree-more appears after 8 incidents
		const moreBtn = serviceSection.getByTestId("tree-more");
		await expect(moreBtn).toBeVisible();
		await expect(moreBtn).toContainText("1 more");
		await moreBtn.click();
		await expect(moreBtn).toHaveCount(0);

		// tree-toggle toggles aria-expanded and displays runs
		const liveServiceSection = page
			.getByTestId("tree-service")
			.filter({ hasText: LIVE.displayName });
		await expect(liveServiceSection).toBeVisible();
		const liveRow = liveServiceSection
			.getByTestId("tree-incident")
			.filter({ has: page.locator(`a[href*="${liveRunInc.id}"]`) });
		await expect(liveRow).toBeVisible();

		const toggleBtn = liveRow.getByTestId("tree-toggle");
		await expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
		await toggleBtn.click();
		await expect(toggleBtn).toHaveAttribute("aria-expanded", "true");

		const treeRun = liveServiceSection.locator(
			`[data-testid="tree-run"][data-run="${completedRun.id}"]`,
		);
		await expect(treeRun).toBeVisible();
		await expect(treeRun).toHaveAttribute(
			"href",
			`/investigations/${completedRun.id}`,
		);

		// nav-incidents-count in sidebar equals Needs-you total
		const countBadge = page
			.getByTestId("sidebar")
			.getByTestId("nav-incidents-count");
		await expect(countBadge).toBeVisible();
		const countText = await countBadge.innerText();
		expect(Number.parseInt(countText, 10)).toBeGreaterThanOrEqual(10);

		// nav-settings at the foot of sidebar
		await expect(page.getByTestId("nav-settings")).toBeVisible();
	});

	test("reopens a resolved incident from the band behind confirm dialog", async ({
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
		const reopenBtn = page.getByTestId("band-reopen");
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
		await expect(page.getByTestId("band-status")).toHaveText("Acknowledged");
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
			session: "failure",
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
		const failedGroup = page.locator(
			'[data-testid="needs-group"][data-need="failed"]',
		);
		await expect(failedGroup).toBeVisible({ timeout: 15_000 });
		const row = failedGroup
			.getByTestId("inbox-row")
			.filter({ hasText: inc.title });
		await row.getByTestId("inbox-row-action").click();

		await expect(page.getByText("Investigation refused").first()).toBeVisible();
		await page.unrouteAll({ behavior: "ignoreErrors" });
	});
});
