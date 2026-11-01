// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import { test } from "../steps/fixtures";
import { fireIncident, LIVE, visit, waitForRun } from "../steps/product";

/**
 * Resume on a run a restart cut off takes up that same run, from the inbox and
 * the overview, never a new investigation (#1010 finding 6, adversary OBJ-005).
 */

/** This stack can't restart mid-test, so the failed run reads as one a restart left for you (the API scenarios make the real one, #981). */
async function readAsInterrupted(page: Page, runId: string) {
	await page.route(
		(url) => url.pathname.startsWith("/api/incidents"),
		async (route) => {
			if (route.request().method() !== "GET") return route.fallback();
			const res = await route.fetch();
			const body = await res.json().catch(() => null);
			const incidents = Array.isArray(body?.data) ? body.data : [body];
			for (const i of incidents)
				for (const r of i?.investigations ?? [])
					if (r.id === runId) {
						r.endReason = "interrupted";
						r.error = "Not resumed: Resume after a restart is off.";
					}
			await route.fulfill({ response: res, json: body });
		},
	);
}

test("Resume on an interrupted run keeps its id, from the inbox and the overview", async ({
	page,
	alertmanager,
	deliverWebhook,
	unique,
}) => {
	const made = await fireIncident(page, alertmanager, deliverWebhook, {
		name: unique("InterruptedResume"),
		service: LIVE,
		session: "failure",
	});
	const run = await waitForRun(
		page,
		made.id,
		(r) => r.status === "failed",
		"the run to end failed",
	);
	await readAsInterrupted(page, run.id);
	const resumed: string[] = [];
	await page.route("**/api/investigations/*/resume", async (route) => {
		resumed.push(new URL(route.request().url()).pathname);
		const own = await page.request.get(`/api/investigations/${run.id}`);
		await route.fulfill({ status: 200, json: await own.json() });
	});
	await page.route(`**/api/incidents/${made.id}/investigate`, (route) =>
		route.abort(),
	);
	const started: string[] = [];
	page.on("request", (r) => {
		if (r.url().includes(`/api/incidents/${made.id}/investigate`))
			started.push(r.url());
	});

	await visit(page, "/incidents");
	const row = page.locator(
		`[data-testid="inbox-row"][data-incident="${made.id}"]`,
	);
	await expect(row.getByTestId("inbox-row-action")).toHaveText("Resume");
	await expect(
		page.locator('[data-testid="needs-group"][data-need="interrupted"]'),
	).toContainText("Run interrupted");
	await row.getByTestId("inbox-row-action").click();
	await expect
		.poll(() => resumed)
		.toEqual([`/api/investigations/${run.id}/resume`]);

	await visit(page, `/incidents/${made.id}`);
	await expect(page.getByTestId("latest-run-strip")).toContainText(
		"interrupted",
	);
	await page.getByTestId("next-resume").click();
	await expect
		.poll(() => resumed)
		.toEqual([
			`/api/investigations/${run.id}/resume`,
			`/api/investigations/${run.id}/resume`,
		]);
	expect(started).toEqual([]);
});
