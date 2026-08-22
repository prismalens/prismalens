// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Locator, type Page, test } from "@playwright/test";

import {
	DETAIL_URL,
	deliver,
	eventFactory,
	installStreamDouble,
	serveAsRunning,
	setTheme,
	SHOTS,
} from "./live-stream-fixtures";

/**
 * #280 — the investigation stream panel groups branches and follows the tail.
 *
 * Two behaviours, both invisible to `live-canvas.spec.ts` (#247), which drives
 * the same page but asserts only on the canvas:
 *
 *  - Branch chrome (the count badge and the collapsible per-branch sections)
 *    belongs to a run that ACTUALLY fanned out. A live fan-out emits `b0`
 *    before `b1`, and a cancelled run's terminal event is stamped `supervisor`
 *    — a single non-`root` branch is the normal case, not a hypothetical.
 *  - Auto-scroll follows new events only while the reader is at the tail.
 *
 * The transport and the `running` status are doubles; see
 * `./live-stream-fixtures.ts` for what is faked and why.
 */

/** The panel's Radix scroll viewport — the element auto-scroll moves. */
function viewport(page: Page): Locator {
	return page
		.getByTestId("investigation-stream-panel")
		.locator("[data-radix-scroll-area-viewport]");
}

async function distanceFromBottom(page: Page): Promise<number> {
	return viewport(page).evaluate(
		(el) => el.scrollHeight - el.scrollTop - el.clientHeight,
	);
}

/** Scroll the panel and wait for the browser's scroll event to land. */
async function scrollTo(page: Page, top: number | "bottom"): Promise<void> {
	await viewport(page).evaluate(
		(el, target) =>
			new Promise<void>((resolve) => {
				const next =
					target === "bottom" ? el.scrollHeight - el.clientHeight : target;
				if (Math.abs(el.scrollTop - next) < 1) {
					resolve();
					return;
				}
				el.addEventListener("scroll", () => resolve(), { once: true });
				el.scrollTop = next;
			}),
		top,
	);
}

/** Open the detail route with the stream connected but silent. */
async function openConnectedPanel(page: Page): Promise<Locator> {
	await serveAsRunning(page);
	await installStreamDouble(page);
	await page.goto(DETAIL_URL);
	const panel = page.getByTestId("investigation-stream-panel");
	await expect(panel.getByTestId("stream-panel-connecting")).toBeVisible({
		timeout: 20_000,
	});
	return panel;
}

/**
 * Switch theme and wait for the reloaded page to reopen its stream. A reload
 * drops the received events AND the `EventSource` double, so delivering before
 * the hook has reconnected throws rather than flaking.
 */
async function reloadInto(
	page: Page,
	panel: Locator,
	theme: "light" | "dark",
): Promise<void> {
	await setTheme(page, theme);
	await expect(panel.getByTestId("stream-panel-connecting")).toBeVisible({
		timeout: 20_000,
	});
}

test.describe("#280 — the investigation stream panel", () => {
	test("renders one non-root branch as the flat list, with no branch chrome", async ({
		page,
	}) => {
		const panel = await openConnectedPanel(page);
		const b0 = eventFactory("b0");

		await deliver(page, b0.agentStep("scout", "Mapping services"));
		await deliver(page, b0.toolResult("search_logs", "412 matching lines"));

		await expect(panel.getByTestId("stream-event-row")).toHaveCount(2);
		await expect(panel.getByTestId("stream-branch-section")).toHaveCount(0);
		await expect(panel.getByTestId("stream-branch-badge")).toHaveCount(0);
		await expect(panel.getByTestId("stream-event-row").first()).toContainText(
			"Mapping services",
		);
	});

	test("renders the single root branch as the flat list", async ({ page }) => {
		const panel = await openConnectedPanel(page);
		const root = eventFactory("root");

		await deliver(page, root.agentStep("scout", "Mapping services"));

		await expect(panel.getByTestId("stream-event-row")).toHaveCount(1);
		await expect(panel.getByTestId("stream-branch-section")).toHaveCount(0);
		await expect(panel.getByTestId("stream-branch-badge")).toHaveCount(0);
	});

	test("renders a section per branch and a counted badge once a run fans out", async ({
		page,
	}) => {
		const panel = await openConnectedPanel(page);
		const b0 = eventFactory("b0");
		const b1 = eventFactory("b1");

		// The window this test exists for: b0 alone is NOT a fan-out yet.
		await deliver(page, b0.agentStep("scout", "Mapping services"));
		await expect(panel.getByTestId("stream-branch-section")).toHaveCount(0);

		await deliver(page, b1.agentStep("analyst", "Correlating deploys"));
		await expect(panel.getByTestId("stream-branch-section")).toHaveCount(2);
		await expect(panel.getByTestId("stream-branch-badge")).toHaveText(
			"2 branches",
		);
		const sections = panel.getByTestId("stream-branch-section");
		await expect(sections.first()).toContainText("b0");
		await expect(sections.nth(1)).toContainText("b1");
	});

	test("follows the tail, but not while the reader has scrolled up", async ({
		page,
	}) => {
		const panel = await openConnectedPanel(page);
		const root = eventFactory("root");

		for (let i = 0; i < 20; i++) {
			await deliver(page, root.agentStep("scout", `Inspecting service ${i}`));
		}
		await expect(panel.getByTestId("stream-event-row")).toHaveCount(20);

		// 1. Untouched, the panel is pinned to the newest row.
		await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(16);

		// 2. Scrolled up to re-read an earlier step, the next event must not
		//    yank the viewport back down.
		await scrollTo(page, 0);
		await deliver(page, root.agentStep("scout", "Inspecting service 20"));
		await expect(panel.getByTestId("stream-event-row")).toHaveCount(21);
		await page.waitForTimeout(300);
		expect(await viewport(page).evaluate((el) => el.scrollTop)).toBe(0);

		// 3. Back at the tail, following resumes.
		await scrollTo(page, "bottom");
		await deliver(page, root.agentStep("scout", "Inspecting service 21"));
		await expect(panel.getByTestId("stream-event-row")).toHaveCount(22);
		await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(16);
	});

	/**
	 * Design evidence for the frontend gate (AGENTS.md): default, dark, empty
	 * and error, captured the same way `rules-management.spec.ts` captures the
	 * rules surface.
	 */
	test("design evidence: default, dark, empty and error states", async ({
		page,
	}) => {
		test.setTimeout(120_000);

		const shot = (name: string) =>
			page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

		const panel = await openConnectedPanel(page);

		// Empty: connected, nothing received yet.
		await reloadInto(page, panel, "dark");
		await page.waitForLoadState("networkidle");
		await shot("stream-panel-empty");

		// Single non-root branch: the flat list this PR restores.
		await reloadInto(page, panel, "light");
		const single = eventFactory("b0");
		await deliver(page, single.agentStep("scout", "Mapping payment services"));
		await deliver(page, single.toolResult("search_logs", "412 matching lines"));
		await deliver(page, single.agentStep("scout", "Narrowing to checkout-api"));
		await expect(panel.getByTestId("stream-branch-section")).toHaveCount(0);
		await page.waitForLoadState("networkidle");
		await shot("stream-panel-single-branch-default");

		// Fanned out: badge plus one collapsible section per branch.
		const fanOut = async () => {
			const b0 = eventFactory("b0");
			const b1 = eventFactory("b1");
			await deliver(page, b0.agentStep("scout", "Mapping payment services"));
			await deliver(page, b0.toolResult("search_logs", "412 matching lines"));
			await deliver(page, b1.agentStep("analyst", "Correlating deploys"));
			await expect(panel.getByTestId("stream-branch-section")).toHaveCount(2);
			await page.waitForLoadState("networkidle");
		};

		await reloadInto(page, panel, "light");
		await fanOut();
		await shot("stream-panel-default");

		await reloadInto(page, panel, "dark");
		await fanOut();
		await shot("stream-panel-dark");

		// Error: a canonical `error` row. The detail route swaps the panel for
		// the polling-fallback card while the stream status IS error, so the row
		// is only visible once a later event moves the status off it.
		await reloadInto(page, panel, "dark");
		const failing = eventFactory("b0");
		await deliver(page, failing.agentStep("scout", "Mapping payment services"));
		await deliver(page, failing.failure("harness lost the tool socket"));
		await deliver(page, failing.agentStep("scout", "Retrying with a new tool"));
		await expect(
			panel.getByText("Error: harness lost the tool socket"),
		).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot("stream-panel-error");
	});
});
