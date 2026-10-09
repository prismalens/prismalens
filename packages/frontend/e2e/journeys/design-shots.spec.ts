// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { test } from "../steps/fixtures";
import {
	acknowledge,
	ensureService,
	fireIncident,
	LIVE,
	openBoard,
	QUIET,
	resolveIncident,
	visit,
	waitForRun,
} from "../steps/product";

/**
 * The design pass's screenshots (#673 D1), compared by hand against
 * ux-v2/shots. Run on purpose: `DESIGN_SHOTS=1 playwright test design-shots`.
 * Writes to design-shots/ (gitignored) or DESIGN_SHOTS_DIR.
 */
const OUT = resolve(
	process.env.DESIGN_SHOTS_DIR ??
		join(dirname(fileURLToPath(import.meta.url)), "../../design-shots"),
);
const SIZES = [
	{ width: 1280, height: 900, themes: ["dark", "light"] },
	{ width: 1440, height: 900, themes: ["dark", "light"] },
	{ width: 1920, height: 1080, themes: ["dark", "light"] },
	{ width: 390, height: 844, themes: ["dark"] },
] as const;

test.skip(!process.env.DESIGN_SHOTS, "design shots run on purpose only");
test.setTimeout(15 * 60_000);

async function theme(page: Page, value: string) {
	await page
		.context()
		.addCookies([
			{ name: "prismalens-theme", value, domain: "localhost", path: "/" },
		]);
}

async function shot(page: Page, name: string) {
	// The breathing dots and the transcript's fade must not catch a mid-frame.
	await page.waitForTimeout(400);
	await page.screenshot({
		path: join(OUT, `${name}.png`),
		animations: "disabled",
	});
}

test("design shots", async ({ page, agents, alertmanager, deliverWebhook }) => {
	mkdirSync(OUT, { recursive: true });
	agents.install(["claude-agent-acp"], "claude");
	let res = await page.request.post("/api/settings/harness/check", {
		data: { id: "claude-code" },
	});
	expect(res.ok(), await res.text()).toBe(true);
	res = await page.request.patch("/api/settings/harness", {
		data: {
			harness: "claude-code",
			models: { "claude-code": "claude-sonnet-5-5" },
			efforts: { "claude-code": "high" },
		},
	});
	expect(res.ok(), await res.text()).toBe(true);

	const done = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "BooklogrApiLatencyP99High",
		service: LIVE,
		severity: "critical",
		session: "success",
	});
	await waitForRun(
		page,
		done.id,
		(r) => r.status === "completed",
		"the done run",
	);
	const live = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "BooklogrCacheMissSpike",
		service: LIVE,
		severity: "warning",
		session: "live",
	});
	await waitForRun(
		page,
		live.id,
		(r) => r.status === "running",
		"the live run",
	);
	// A reportless run stopped by the operator: both verbs act on it (#673 w59).
	const stopped = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "BooklogrQueueLag",
		service: LIVE,
		severity: "warning",
		session: "live",
	});
	const halt = await waitForRun(
		page,
		stopped.id,
		(r) => r.status === "running",
		"the run to stop",
	);
	expect(
		(await page.request.post(`/api/investigations/${halt.id}/cancel`)).ok(),
	).toBe(true);
	await waitForRun(
		page,
		stopped.id,
		(r) => r.status === "cancelled",
		"the stopped run",
	);

	for (const size of SIZES) {
		await page.setViewportSize({ width: size.width, height: size.height });
		for (const t of size.themes) {
			await theme(page, t);
			const tag = `${size.width}-${t}`;
			await openBoard(page);
			await shot(page, `board-${tag}`);
			await visit(page, `/incidents/${live.id}`);
			await shot(page, `overview-live-${tag}`);
			await visit(page, `/incidents/${live.id}/conversation`);
			await expect(page.getByTestId("transcript")).toBeVisible();
			await shot(page, `conversation-live-${tag}`);
			await visit(page, `/incidents/${done.id}/conversation`);
			await expect(page.getByTestId("transcript-end")).toBeVisible();
			await shot(page, `conversation-done-${tag}`);
			await visit(page, `/incidents/${done.id}/report`);
			await expect(page.getByTestId("report-answer")).toBeVisible();
			await shot(page, `report-${tag}`);
			await visit(page, `/incidents/${done.id}/conversation?investigation=new`);
			await expect(page.getByTestId("draft-heading")).toBeVisible();
			// This incident has a report, so the draft opens on Ask.
			await expect(page.getByTestId("verb-chip")).toHaveAttribute(
				"data-verb",
				"ask",
			);
			await shot(page, `conversation-draft-ask-${tag}`);
			await page.getByTestId("verb-chip").click();
			await expect(page.getByTestId("verb-menu")).toBeVisible();
			await shot(page, `picker-verbs-${tag}`);
			await page.getByTestId("verb-investigate").click();
			await expect(page.getByTestId("composer-investigate")).toBeVisible();
			await shot(page, `conversation-draft-investigate-${tag}`);
			await visit(page, `/incidents/${stopped.id}/conversation`);
			await expect(page.getByTestId("verb-chip")).toHaveAttribute(
				"data-verb",
				"investigate",
			);
			await shot(page, `conversation-stopped-${tag}`);
			await visit(page, `/incidents/${done.id}/conversation?investigation=new`);
			await expect(page.getByTestId("draft-heading")).toBeVisible();
			for (const [chip, menu, name] of [
				["agent-picker", "agent-picker-list", "picker-models"],
				["effort-chip", "effort-menu", "picker-effort"],
				["access-chip", "access-menu", "picker-permissions"],
			] as const) {
				await page.getByTestId(chip).click();
				await expect(page.getByTestId(menu)).toBeVisible();
				await shot(page, `${name}-${tag}`);
				await page.keyboard.press("Escape");
				await expect(page.getByTestId(menu)).toBeHidden();
			}
		}
	}
});

/** The usage strip shows until OK, so the first-run shots serve a fresh install's flags. */
async function freshTelemetry(page: Page) {
	await page.route("**/api/settings/telemetry", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				enabled: true,
				forcedOff: false,
				noticed: true,
				dismissed: false,
				recentlySent: [],
			}),
		}),
	);
}

test("design shots D2", async ({
	page,
	agents,
	alertmanager,
	deliverWebhook,
}) => {
	mkdirSync(OUT, { recursive: true });
	agents.install(["claude-agent-acp"], "claude");
	const res = await page.request.post("/api/settings/harness/check", {
		data: { id: "claude-code" },
	});
	expect(res.ok(), await res.text()).toBe(true);
	const set = await page.request.patch("/api/settings/harness", {
		data: { harness: "claude-code" },
	});
	expect(set.ok(), await set.text()).toBe(true);

	const shots = async (name: string, path: string, ready: string) => {
		for (const size of SIZES) {
			await page.setViewportSize({ width: size.width, height: size.height });
			for (const t of size.themes) {
				await theme(page, t);
				await visit(page, path);
				await expect(page.getByTestId(ready).first()).toBeVisible();
				await shot(page, `${name}-${size.width}-${t}`);
			}
		}
	};

	// First run: an empty workspace, before anything below fires.
	await page.request.post("/api/settings/danger/reset-data", {
		data: { confirmation: "RESET" },
	});
	await freshTelemetry(page);
	await shots("first-run", "/incidents", "first-run");
	await page.unrouteAll();

	const done = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "WalkOutOfOrder",
		service: LIVE,
		severity: "high",
		session: "success",
	});
	await waitForRun(page, done.id, (r) => r.status === "completed", "done");
	const ended = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "BooklogrApiLatencyP99High",
		service: LIVE,
		severity: "critical",
		session: "success",
	});
	await waitForRun(page, ended.id, (r) => r.status === "completed", "ended");
	await resolveIncident(page, ended.id, {
		actualCause: "Pool size reduced to 1 while the server uses 8 threads.",
	});
	await fireIncident(page, alertmanager, deliverWebhook, {
		name: "WalkPicker",
		service: QUIET,
		severity: "warning",
		quiet: true,
	});
	const live = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "BooklogrCacheMissSpike",
		service: LIVE,
		severity: "warning",
		session: "live",
	});
	await waitForRun(page, live.id, (r) => r.status === "running", "live");
	const service = await ensureService(page, LIVE);
	// The board as the mockup draws it: acknowledged runs, the usage strip seen.
	await acknowledge(page, done.id);
	await acknowledge(page, live.id);
	await page.request.put("/api/settings/telemetry", {
		data: { noticed: true, dismissed: true },
	});

	await shots("board", "/incidents", "incident-board");
	await shots("services", "/services", "services-page");
	await shots("service-detail", `/services/${service}`, "service-page");
	await shots("settings-agent", "/settings?tab=harness", "harness-settings");
	await shots("settings-usage", "/settings?tab=usage", "telemetry-row");
});
