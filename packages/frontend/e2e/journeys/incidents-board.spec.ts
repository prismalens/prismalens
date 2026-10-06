// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Locator, type Page, test } from "@playwright/test";
import { hideQueryDevtools } from "./live-stream-fixtures";
import { settled } from "./settled";

/**
 * #743 — the board: four columns derived from state, beside the list. A card
 * dropped on another column does the one action that move means: a run starts
 * at once, Resolve and Reopen ask first (study-v3 §3.1).
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
	await page.mouse.move(
		from.x + from.width / 2 + 10,
		from.y + from.height / 2,
		{
			steps: 4,
		},
	);
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
		await settled(page);
	});

	test("a drop on Working starts the run at once; a refusal sends the card back", async ({
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
						message: "No coding agent on this machine.",
						data: {
							failure: "no-harness",
							reason: "No coding agent on this machine.",
						},
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

		// While dragging, Working takes the drop.
		const release = await dragTo(
			page,
			card,
			page.getByTestId("board-column-working"),
		);
		await expect(
			page.getByTestId("board-column-working").locator("[data-drop]"),
		).toHaveAttribute("data-drop", "valid");
		await release();

		// No form and no brief: the run is asked for at once (study-v3 §3.1).
		await expect.poll(() => investigateCalls.length).toBe(1);
		await expect(page.getByTestId("board-drop-prompt")).toHaveCount(0);
		expect(investigateCalls[0] ?? {}).not.toHaveProperty("brief");
		// Refused by the server: the card returns and the reason is told.
		await expect(page.getByText("Investigation refused").first()).toBeVisible();
		await expect(card).toBeVisible();
	});

	test("a drop on Resolved opens Resolve; a drop on Needs you is refused", async ({
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
		const dialog = page.getByTestId("resolve-dialog");
		await expect(dialog).toContainText("Resolve INC-");
		await dialog.getByTestId("confirm-resolve").click();
		await expect
			.poll(async () => {
				const res = await page.request.get(`/api/incidents/${id}`);
				return ((await res.json()) as { status: string }).status;
			})
			.toBe("closed");

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
		await expect(
			page.getByTestId("board-column-needs_you").locator("[data-drop]"),
		).toHaveAttribute("data-drop", "refused");
		await refused();
		await expect(dialog).toHaveCount(0);
		await expect(page.getByTestId("reopen-dialog")).toHaveCount(0);
	});

	test("the sidebar groups incidents by service, folds a group for good, and creates nothing", async ({
		page,
	}) => {
		// Order-dependent otherwise: no seeded incident carries zero services, so
		// "No service" only appeared because an earlier test in the file happened
		// to leave one behind. Create our own so this test holds alone too.
		await createIncident(page, `Board no-service ${Date.now()}`);
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

		// The header's New is the one manual entry (decision 4): a group has no +.
		await expect(sidebar.getByTestId("sidebar-group-new")).toHaveCount(0);

		// Alerts group by their own service.
		await page.goto("/alerts");
		await page.getByTestId("group-by-alerts").selectOption("service");
		await expect(
			page.getByTestId("alert-list-pane").getByTestId("service-lane").first(),
		).toBeVisible({ timeout: 15_000 });
	});

	test("a resolved incident reopens from the band, or by a drop on Working only after asking", async ({
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
		const resolveByApi = async (id: string) =>
			expect(
				(
					await page.request.post(`/api/incidents/${id}/close`, { data: {} })
				).ok(),
			).toBeTruthy();

		// Reopen is the band's one action on a Resolved incident, behind a confirm.
		const bandTitle = `Reopen band ${Date.now()}`;
		const bandId = await createIncident(page, bandTitle);
		await resolveByApi(bandId);
		await page.goto(`/incidents/${bandId}`);
		await page.getByTestId("band-reopen").click({ timeout: 15_000 });
		const dialog = page.getByTestId("reopen-dialog");
		await expect(dialog).toContainText("Reopen INC-");
		await expect(dialog).toContainText(
			"Its cause stays as Previous cause until you resolve it again.",
		);
		await dialog.getByTestId("confirm-reopen-incident").click();
		await expect.poll(() => statusOf(bandId)).toBe("investigating");
		await expect(page.getByTestId("band-status")).toHaveText("Acknowledged");
		// No run started: the box still offers Investigate.
		await expect(page.getByTestId("overview-report")).toContainText(
			"No investigation yet",
		);
		await expect(page.getByTestId("composer-investigate")).toHaveText(
			"Start investigation",
		);

		// On the board a Resolved card sits in Resolved; dropped on Working it
		// asks first, and Cancel leaves it Resolved with no run.
		const dropTitle = `Reopen drop ${Date.now()}`;
		const dropId = await createIncident(page, dropTitle);
		await resolveByApi(dropId);
		await page.goto("/incidents");
		const card = page
			.getByTestId("board-column-resolved")
			.getByTestId("board-card")
			.filter({ hasText: dropTitle });
		await expect(card).toBeVisible({ timeout: 15_000 });
		const release = await dragTo(
			page,
			card,
			page.getByTestId("board-column-working"),
		);
		await expect(
			page.getByTestId("board-column-working").locator("[data-drop]"),
		).toHaveAttribute("data-drop", "valid");
		await release();
		const ask = page.getByTestId("reopen-dialog");
		await expect(ask).toContainText(/Reopen INC-\d+ and investigate\?/);
		await ask.getByRole("button", { name: "Cancel" }).click();
		await expect(ask).toHaveCount(0);
		expect(await statusOf(dropId)).toBe("closed");
		expect(investigated).toHaveLength(0);
	});
});
