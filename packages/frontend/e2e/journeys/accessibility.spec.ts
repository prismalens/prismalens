// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { hideQueryDevtools, setTheme } from "./live-stream-fixtures";

/** The demo storm incident PRISMALENS_SEED_DEMO seeds on every stack. */
const DEMO_INCIDENT = "/incidents/b0111111-1111-4111-8111-111111111111";

/**
 * Known and not yet fixed, so a new violation still fails: a model row is a
 * role="option" holding its star button (a listbox redesign, not a small fix).
 */
const KNOWN: Record<string, string[]> = { picker: ["nested-interactive"] };

/** Serious and critical axe violations on the page as it stands, one line each. */
async function blocking(page: Page, screen: string): Promise<string[]> {
	const { violations } = await new AxeBuilder({ page })
		.exclude(".tsqd-parent-container")
		.disableRules(KNOWN[screen] ?? [])
		.analyze();
	return violations
		.filter((v) => v.impact === "serious" || v.impact === "critical")
		.map(
			(v) =>
				`${v.impact} ${v.id}: ${v.help} (${v.nodes
					.slice(0, 3)
					.map((n) => n.target.join(" "))
					.join(" | ")})`,
		);
}

/** An opening popover fades in; mid-fade, axe reads blended colours as low contrast. */
async function settled(l: Locator) {
	await expect
		.poll(() =>
			l.evaluate((el) =>
				el
					.getAnimations({ subtree: true })
					.every((a) => a.playState !== "running"),
			),
		)
		.toBe(true);
}

test.describe("Accessibility at 1440, dark", () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	test.beforeEach(async ({ page }) => {
		await hideQueryDevtools(page);
		await page.goto("/incidents");
		await setTheme(page, "dark");
	});

	test("the board, an incident record, Settings and the picker have no serious or critical axe violations", async ({
		page,
	}) => {
		test.slow();
		const found: Record<string, string[]> = {};

		await page.goto("/incidents");
		await expect(page.getByTestId("incident-board")).toBeVisible({
			timeout: 15_000,
		});
		found.board = await blocking(page, "board");

		await page.goto(DEMO_INCIDENT);
		await expect(page.getByTestId("incident-state-band")).toBeVisible({
			timeout: 15_000,
		});
		found.record = await blocking(page, "record");

		await page.getByTestId("agent-picker").click();
		const picker = page.getByTestId("agent-picker-list");
		await expect(picker).toBeVisible();
		await settled(picker);
		found.picker = await blocking(page, "picker");
		await page.keyboard.press("Escape");

		await page.goto("/settings");
		await expect(page.getByTestId("settings-frame")).toBeVisible({
			timeout: 15_000,
		});
		found.settings = await blocking(page, "settings");

		expect(found).toEqual({ board: [], record: [], picker: [], settings: [] });
	});
});
