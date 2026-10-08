// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { test } from "../steps/fixtures";
import {
	fireIncident,
	LIVE,
	openBoard,
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
			await shot(page, `conversation-draft-${tag}`);
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
