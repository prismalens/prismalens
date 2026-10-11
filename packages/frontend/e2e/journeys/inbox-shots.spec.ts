// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { fingerprintOf } from "../../../../scripts/fakes/fake-alertmanager.mjs";
import { test } from "../steps/fixtures";
import {
	fireIncident,
	LIVE,
	QUIET,
	resolveIncident,
	visit,
	waitForRun,
} from "../steps/product";

/**
 * The inbox redesign's screenshots (#811), compared by hand against the
 * mockup artboards. Run on purpose: `DESIGN_SHOTS=1 playwright test inbox-shots`.
 */
const OUT = resolve(
	process.env.DESIGN_SHOTS_DIR ??
		join(dirname(fileURLToPath(import.meta.url)), "../../design-shots"),
);
const SIZES = [
	{ width: 1280, height: 800 },
	{ width: 1440, height: 900 },
	{ width: 1920, height: 1080 },
] as const;
const THEMES = ["dark", "light"] as const;

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
	await page.waitForTimeout(500);
	await page.screenshot({
		path: join(OUT, `${name}.png`),
		animations: "disabled",
	});
}

/** Paints the native window controls the way the OS would, for the frame shots. */
async function fakeControls(page: Page, platform: "win32" | "darwin") {
	await page.evaluate((p) => {
		const el = document.createElement("div");
		el.style.cssText =
			p === "win32"
				? "position:fixed;top:0;right:0;width:138px;height:40px;z-index:9999;display:flex;align-items:center;justify-content:space-around;color:var(--text-2);font:12px sans-serif;pointer-events:none;outline:1px dashed oklch(0.7 0.19 25 / .5)"
				: "position:fixed;top:13px;left:14px;z-index:9999;display:flex;gap:8px;pointer-events:none";
		el.innerHTML =
			p === "win32"
				? "<span>&#8212;</span><span>&#9633;</span><span>&#10005;</span>"
				: ["#ff5f57", "#febc2e", "#28c840"]
						.map(
							(c) =>
								`<span style="width:12px;height:12px;border-radius:50%;background:${c}"></span>`,
						)
						.join("");
		document.body.appendChild(el);
	}, platform);
}

/** One incident fires harder than an hour ago: alerts cannot be backdated through the webhook. */
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

test("inbox shots", async ({ page, agents, alertmanager, deliverWebhook }) => {
	mkdirSync(OUT, { recursive: true });
	await page.request.post("/api/settings/danger/reset-data", {
		data: { confirmation: "RESET" },
	});
	await page.request.put("/api/settings/telemetry", {
		data: { noticed: true, dismissed: true },
	});

	// No agent: the setup card in the Needs-you slot (Inbox-empty).
	const gone = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "BooklogrApiLatencyP99High",
		service: QUIET,
		quiet: true,
	});
	await resolveIncident(page, gone.id);
	// The stack's fake agent answers checks; the empty state is the one before any did.
	await page.route("**/api/settings/harnesses*", async (route) => {
		const res = await route.fetch();
		const body = await res.json();
		for (const h of body.harnesses ?? []) h.checked = null;
		await route.fulfill({ response: res, json: body });
	});
	for (const t of THEMES) {
		await page.setViewportSize({ width: 1280, height: 800 });
		await theme(page, t);
		await visit(page, "/incidents");
		await expect(page.getByTestId("inbox-setup")).toBeVisible();
		await shot(page, `inbox-empty-1280-${t}`);
	}
	await page.unrouteAll({ behavior: "ignoreErrors" });

	// First load: the lists hang, the skeletons show (Inbox-loading).
	await page.route("**/api/incidents?**", () => {});
	await theme(page, "dark");
	await visit(page, "/incidents");
	await shot(page, "inbox-loading-1280-dark");
	await page.unrouteAll({ behavior: "ignoreErrors" });

	agents.install(["claude-agent-acp"], "claude");
	expect(
		(
			await page.request.post("/api/settings/harness/check", {
				data: { id: "claude-code" },
			})
		).ok(),
	).toBe(true);
	expect(
		(
			await page.request.patch("/api/settings/harness", {
				data: { harness: "claude-code" },
			})
		).ok(),
	).toBe(true);

	const ready = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "WalkGrouped",
		service: LIVE,
		severity: "high",
		session: "success",
	});
	const failed = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "CodexProbe",
		service: LIVE,
		severity: "high",
		session: "failure",
	});
	const nocause = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "QA manual incident",
		service: LIVE,
		severity: "medium",
		session: "nocause",
	});
	const stopped = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "CodexRefire",
		service: LIVE,
		severity: "medium",
		session: "live",
	});
	const live = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "BookMetadataTrafficStallOnSearchIndexRebuildAfterNightlyReindexJob",
		service: LIVE,
		severity: "medium",
		session: "live",
	});
	const cleared = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "BooklogrApiLatencyP99High2",
		service: QUIET,
		severity: "high",
		quiet: true,
	});
	await fireIncident(page, alertmanager, deliverWebhook, {
		name: "NotesEndpointSlow",
		service: QUIET,
		severity: "low",
		quiet: true,
	});
	await waitForRun(page, ready.id, (r) => r.status === "completed", "ready");
	await waitForRun(page, failed.id, (r) => r.status === "failed", "failed");
	await waitForRun(
		page,
		nocause.id,
		(r) => r.status === "completed",
		"nocause",
	);
	const halt = await waitForRun(
		page,
		stopped.id,
		(r) => r.status === "running",
		"to stop",
	);
	await page.request.post(`/api/investigations/${halt.id}/cancel`);
	await waitForRun(
		page,
		stopped.id,
		(r) => r.status === "cancelled",
		"stopped",
	);
	await waitForRun(page, live.id, (r) => r.status === "running", "live");
	const fp = fingerprintOf(cleared.labels);
	alertmanager.clear(fp);
	await deliverWebhook([fp]);

	await worsen(page, "WalkGrouped");
	for (const size of SIZES) {
		await page.setViewportSize(size);
		for (const t of THEMES) {
			await theme(page, t);
			await visit(page, "/incidents");
			await expect(page.getByTestId("needs-group").first()).toBeVisible();
			await shot(page, `inbox-${size.width}-${t}`);
		}
	}
	await page.setViewportSize({ width: 1440, height: 900 });
	await theme(page, "dark");
	await visit(page, "/incidents");
	await page
		.getByRole("button", { name: `Runs and questions in INC-${ready.number}` })
		.click();
	await expect(page.getByTestId("tree-run").first()).toBeVisible();
	await shot(page, "inbox-1440-dark-expanded");
	await visit(page, `/incidents/${ready.id}`);
	await shot(page, "overview-sidebar-1440-dark");
	await visit(page, "/incidents?view=all");
	await expect(page.getByTestId("all-row").first()).toBeVisible();
	await shot(page, "all-incidents-1440-dark");

	for (const platform of ["win32", "darwin"] as const) {
		for (const width of [1440, 1100]) {
			await page.setViewportSize({ width, height: width === 1440 ? 900 : 760 });
			await page.addInitScript((p) => {
				(window as unknown as { prismalensDesktop: object }).prismalensDesktop =
					{ platform: p, setTheme: () => {} };
			}, platform);
			await visit(page, "/incidents");
			await expect(page.getByTestId("needs-group").first()).toBeVisible();
			await fakeControls(page, platform);
			await shot(page, `desktop-${platform}-${width}-dark`);
		}
	}
});
