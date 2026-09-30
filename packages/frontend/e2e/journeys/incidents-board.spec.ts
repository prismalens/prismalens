// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Locator, type Page, test } from "@playwright/test";
import { hideQueryDevtools, SHOTS } from "./live-stream-fixtures";

/**
 * #743 — the board: four columns derived from state, beside the list. A card
 * dropped on another column asks for the one action that move means, and
 * nothing runs until the operator confirms it.
 */

async function createIncident(page: Page, title: string): Promise<string> {
	const created = await page.request.post("/api/incidents", {
		data: { title },
	});
	expect(created.ok()).toBeTruthy();
	const incident: { id: string } = await created.json();
	return incident.id;
}

/** Drag with the mouse in steps, so the pointer sensor's distance is crossed. */
async function dragTo(page: Page, card: Locator, target: Locator) {
	const from = await card.boundingBox();
	const to = await target.boundingBox();
	if (!from || !to) throw new Error("card or column has no box");
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, {
		steps: 4,
	});
	await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 12 });
	return async () => {
		await page.mouse.up();
	};
}

test.describe("#743 — the incidents board", () => {
	test.beforeEach(({ page }) => hideQueryDevtools(page));

	test("sits beside the list, with a column per state", async ({ page }) => {
		await page.goto("/incidents");
		await expect(page.getByTestId("incident-board")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("incident-list-pane")).toBeVisible();
		for (const id of ["needs_you", "working", "concluded", "resolved"]) {
			await expect(page.getByTestId(`board-column-${id}`)).toBeVisible();
		}
		await page.waitForLoadState("networkidle");
		await page.screenshot({ path: `${SHOTS}/incidents-board-default.png` });
	});

	test("a drop on Working asks for the agent and a brief before it runs", async ({
		page,
	}) => {
		const title = `Board drop ${Date.now()}`;
		const id = await createIncident(page, title);
		const investigateCalls: unknown[] = [];
		await page.route(
			(url) => url.pathname === `/api/incidents/${id}/investigate`,
			async (route) => {
				investigateCalls.push(route.request().postDataJSON());
				await route.fulfill({
					status: 412,
					contentType: "application/json",
					body: JSON.stringify({
						defined: true,
						code: "PRECONDITION_FAILED",
						status: 412,
						message: "No coding agent found on PATH.",
						data: { failure: "no-harness", reason: "No coding agent found on PATH." },
					}),
				});
			},
		);

		await page.goto("/incidents");
		const card = page
			.getByTestId("board-column-needs_you")
			.getByTestId("board-card")
			.filter({ hasText: title });
		await expect(card).toBeVisible({ timeout: 15_000 });

		// While dragging, Working takes the drop and Needs you does not.
		const release = await dragTo(
			page,
			card,
			page.getByTestId("board-column-working"),
		);
		await expect(page.getByTestId("board-column-working")).toHaveAttribute(
			"data-drop",
			"valid",
		);
		await page.screenshot({ path: `${SHOTS}/incidents-board-dragging.png` });
		await release();

		const prompt = page.getByTestId("board-drop-prompt");
		await expect(prompt).toContainText("Investigate INC-");
		expect(investigateCalls).toHaveLength(0);

		// Escape cancels: nothing ran, the card is where it was.
		await page.keyboard.press("Escape");
		await expect(prompt).toHaveCount(0);
		expect(investigateCalls).toHaveLength(0);
		await expect(card).toBeVisible();

		// The card animates home from the first drop before it can be picked up again.
		await page.waitForTimeout(400);
		// Again, with a brief: the button starts the run with it.
		const again = await dragTo(
			page,
			card,
			page.getByTestId("board-column-working"),
		);
		await again();
		await prompt.getByTestId("composer-input").fill("Check the 14:00 deploy.");
		await prompt.getByTestId("composer-investigate").click();
		await expect.poll(() => investigateCalls.length).toBe(1);
		expect(investigateCalls[0]).toMatchObject({
			brief: "Check the 14:00 deploy.",
		});
		// Refused by the server: the card returns and the reason is told.
		await expect(page.getByText("Investigation refused").first()).toBeVisible();
		await expect(card).toBeVisible();
	});

	test("a drop on Resolved asks first; a drop on Needs you is refused", async ({
		page,
	}) => {
		const title = `Board resolve ${Date.now()}`;
		const id = await createIncident(page, title);
		await page.goto("/incidents");
		const card = page.getByTestId("board-card").filter({ hasText: title });
		await expect(card).toBeVisible({ timeout: 15_000 });

		const resolved = await dragTo(
			page,
			card,
			page.getByTestId("board-column-resolved"),
		);
		await resolved();
		const prompt = page.getByTestId("board-drop-prompt");
		await expect(prompt).toContainText("Resolve INC-");
		await prompt.getByTestId("board-drop-confirm").click();
		await expect
			.poll(async () => {
				const res = await page.request.get(`/api/incidents/${id}`);
				return ((await res.json()) as { status: string }).status;
			})
			.toBe("resolved");

		// A card in Concluded cannot go to Needs you: nothing is asked.
		const concluded = page
			.getByTestId("board-column-concluded")
			.getByTestId("board-card")
			.first();
		await expect(concluded).toBeVisible();
		const refused = await dragTo(
			page,
			concluded,
			page.getByTestId("board-column-needs_you"),
		);
		await expect(page.getByTestId("board-column-needs_you")).toHaveAttribute(
			"data-drop",
			"refused",
		);
		await refused();
		await expect(prompt).toHaveCount(0);
	});

	test("groups the board, the list and the alerts by service, and remembers it", async ({
		page,
	}) => {
		await page.goto("/incidents");
		await expect(page.getByTestId("incident-board")).toBeVisible({
			timeout: 15_000,
		});
		await page.getByTestId("group-by-board").selectOption("service");
		const board = page.getByTestId("incident-board");
		const lanes = board.getByTestId("service-lane");
		await expect(lanes.first()).toBeVisible();
		// Column counts count each incident once, whatever lanes it sits in.
		const total = await page.getByTestId("board-card").count();
		expect(total).toBeGreaterThanOrEqual(3);

		// A lane folds, and stays folded after a reload.
		const first = lanes.first();
		const laneId = await first.getAttribute("data-lane");
		await first.click();
		await expect(first).toHaveAttribute("aria-expanded", "false");
		await page.reload();
		await expect(
			page.locator(`[data-testid="service-lane"][data-lane="${laneId}"]`).first(),
		).toHaveAttribute("aria-expanded", "false", { timeout: 15_000 });
		await page.screenshot({ path: `${SHOTS}/incidents-board-by-service.png` });

		// The list pane groups on its own choice.
		await expect(
			page.getByTestId("incident-list-pane").getByTestId("service-lane"),
		).toHaveCount(0);
		await page.getByTestId("group-by-list").selectOption("service");
		await expect(
			page.getByTestId("incident-list-pane").getByTestId("service-lane").first(),
		).toBeVisible();

		// Alerts group by their own service.
		await page.goto("/alerts");
		await page.getByTestId("group-by-alerts").selectOption("service");
		await expect(
			page.getByTestId("alert-list-pane").getByTestId("service-lane").first(),
		).toBeVisible({ timeout: 15_000 });
	});
});
