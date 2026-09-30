// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Locator, type Page, test } from "@playwright/test";
import { hideQueryDevtools } from "./live-stream-fixtures";

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

	test("the sidebar groups incidents by service, folds a group for good, and starts one in a service", async ({
		page,
	}) => {
		await page.goto("/incidents");
		const sidebar = page.getByTestId("incident-list-pane");
		const groups = sidebar.getByTestId("sidebar-group");
		await expect(groups.first()).toBeVisible({ timeout: 15_000 });
		// The board has no lanes of its own any more.
		await expect(
			page.getByTestId("incident-board").getByTestId("service-lane"),
		).toHaveCount(0);

		// The seeded API Gateway incident sits under its service, once.
		const gateway = groups.filter({ hasText: "API Gateway" });
		await expect(gateway).toHaveCount(1);
		await expect(
			gateway.getByTestId("incident-row").filter({ hasText: "[demo] Storm" }),
		).toHaveCount(1);
		// No service sits below every service; only Settled, when present, follows it.
		const settled = groups.filter({
			has: page.locator('[data-lane="settled"]'),
		});
		const hasSettled = (await settled.count()) > 0;
		await expect(
			groups.nth((await groups.count()) - (hasSettled ? 2 : 1)),
		).toContainText("No service");

		// A group folds, and stays folded after a reload.
		const header = gateway.getByTestId("service-lane");
		await header.click();
		await expect(header).toHaveAttribute("aria-expanded", "false");
		await expect(gateway.getByTestId("incident-row")).toHaveCount(0);
		await page.reload();
		await expect(
			sidebar
				.getByTestId("sidebar-group")
				.filter({ hasText: "API Gateway" })
				.getByTestId("service-lane"),
		).toHaveAttribute("aria-expanded", "false", { timeout: 15_000 });
		await sidebar
			.getByTestId("sidebar-group")
			.filter({ hasText: "API Gateway" })
			.getByTestId("service-lane")
			.click();

		// The group's + opens New incident with that service picked.
		const groupWithNew = sidebar
			.getByTestId("sidebar-group")
			.filter({ hasText: "API Gateway" });
		await groupWithNew.hover();
		await groupWithNew.getByTestId("sidebar-group-new").click();
		const dialog = page.getByTestId("create-incident-dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText("API Gateway");
		await page.keyboard.press("Escape");

		// Alerts group by their own service.
		await page.goto("/alerts");
		await page.getByTestId("group-by-alerts").selectOption("service");
		await expect(
			page.getByTestId("alert-list-pane").getByTestId("service-lane").first(),
		).toBeVisible({ timeout: 15_000 });
	});

	test("a resolved incident reopens from the band or by a drop on Concluded, without starting a run", async ({
		page,
	}) => {
		const statusOf = async (id: string) => {
			const res = await page.request.get(`/api/incidents/${id}`);
			return ((await res.json()) as { status: string }).status;
		};
		const investigated: string[] = [];
		await page.route("**/api/incidents/*/investigate", async (route) => {
			investigated.push(route.request().url());
			await route.abort();
		});

		// From the band's menu, behind a confirm.
		const bandTitle = `Reopen band ${Date.now()}`;
		const bandId = await createIncident(page, bandTitle);
		expect(
			(await page.request.post(`/api/incidents/${bandId}/resolve`)).ok(),
		).toBeTruthy();
		await page.goto(`/incidents/${bandId}`);
		await expect(page.getByTestId("band-close")).toBeVisible({
			timeout: 15_000,
		});
		await page.getByTestId("band-more").click();
		await page.getByTestId("band-menu-reopen").click();
		const dialog = page.getByTestId("reopen-dialog");
		await expect(dialog).toContainText(`Reopen INC-`);
		await expect(dialog).toContainText(
			"It goes back to Investigating and its resolve time is cleared.",
		);
		await dialog.getByTestId("confirm-reopen-incident").click();
		await expect.poll(() => statusOf(bandId)).toBe("investigating");
		await expect(page.getByTestId("band-status")).toHaveText("Investigating");
		// No run started: the box still offers Investigate.
		await expect(page.getByTestId("run-card")).toContainText("No run yet");
		await expect(page.getByTestId("composer-investigate")).toHaveText(
			"Investigate",
		);

		// On the board: a resolved card waits in Needs you; dropped on Concluded
		// it asks, then reopens.
		const dropTitle = `Reopen drop ${Date.now()}`;
		const dropId = await createIncident(page, dropTitle);
		expect(
			(await page.request.post(`/api/incidents/${dropId}/resolve`)).ok(),
		).toBeTruthy();
		await page.goto("/incidents");
		const card = page
			.getByTestId("board-column-needs_you")
			.getByTestId("board-card")
			.filter({ hasText: dropTitle });
		await expect(card).toBeVisible({ timeout: 15_000 });
		const release = await dragTo(
			page,
			card,
			page.getByTestId("board-column-concluded"),
		);
		await expect(page.getByTestId("board-column-concluded")).toHaveAttribute(
			"data-drop",
			"valid",
		);
		await release();
		const prompt = page.getByTestId("board-drop-prompt");
		await expect(prompt).toContainText("Reopen INC-");
		await prompt.getByTestId("board-drop-confirm").click();
		await expect.poll(() => statusOf(dropId)).toBe("investigating");
		await expect(
			page
				.getByTestId("board-column-concluded")
				.getByTestId("board-card")
				.filter({ hasText: dropTitle }),
		).toBeVisible();
		expect(investigated).toHaveLength(0);
	});
});
