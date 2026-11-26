// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import { defineChecks, verdict } from "../bar";

/** The open menu's row ids (`menu-<id>` less its keys and why parts), from the kit menu (#1127). */
async function menuRows(page: Page): Promise<string[]> {
	const menu = page.getByRole("menu").last();
	await expect(menu).toBeVisible({ timeout: 15_000 });
	return menu
		.locator("[data-testid^='menu-']")
		.evaluateAll((els) =>
			els
				.map((e) => (e.getAttribute("data-testid") ?? "").slice(5))
				.filter((id) => id && !id.endsWith("-keys") && !id.endsWith("-why")),
		);
}

/** #1101 category 20, Thread menu. */
export default defineChecks([
	{
		item: "20.2",
		async run({ page, open, sim }) {
			// Open an unsettled project thread
			await open(sim.thread("huge.diff", 0));
			await expect(page.getByTestId("thread-page")).toBeVisible();

			const menuButton = page
				.locator("main")
				.getByTestId("thread-menu")
				.or(page.getByRole("button", { name: "Thread actions" }))
				.first();
			await expect(menuButton).toBeVisible();
			// A click on a header still loading is lost on the slow link: retry until the menu opens.
			await expect(async () => {
				await page.keyboard.press("Escape");
				await menuButton.click();
				await expect(page.getByTestId("menu-rename")).toBeVisible({
					timeout: 4000,
				});
			}).toPass({ timeout: 60_000 });

			const expectedItems = [
				{ id: "rename", name: "Rename", key: "F2" },
				{ id: "pin", name: "Pin", key: "Alt+Shift+P" },
				{ id: "fork", name: "Fork here", key: "F" },
				{ id: "aside", name: "Side question", key: "B" },
				{ id: "settle", name: "Settle", key: "S" },
				{ id: "archive", name: "Archive", key: "Alt+Shift+A" },
				{ id: "worktree", name: "Work in / Move to worktree", key: "W" },
				{ id: "link", name: "Copy link", key: "L" },
				{ id: "transcript", name: "Copy transcript", key: "T" },
			];

			const fails: string[] = [];
			const measured: string[] = [];

			for (const item of expectedItems) {
				const el = page.getByTestId(`menu-${item.id}`);
				if (!(await el.isVisible())) {
					fails.push(`missing menu item ${item.name} (menu-${item.id})`);
				} else {
					measured.push(item.name);
				}
			}

			await page.keyboard.press("Escape");

			return verdict(
				fails,
				`${measured.length} of ${expectedItems.length} menu items present: ${measured.join(", ")}`,
			);
		},
	},
	{
		item: "20.3",
		async run({ page, open, sim }) {
			const fails: string[] = [];

			// 1. A disabled item says why: on incident thread, Fork here is disabled and says why
			await open(sim.thread("limit.out-of-credit"));
			await expect(page.getByTestId("thread-page")).toBeVisible();
			const incMenuButton = page
				.locator("main")
				.getByTestId("thread-menu")
				.or(page.getByRole("button", { name: "Thread actions" }))
				.first();
			await expect(incMenuButton).toBeVisible();
			await incMenuButton.click();

			const forkItem = page.getByTestId("menu-fork");
			await expect(forkItem).toBeVisible();
			const forkDisabled = await forkItem.getAttribute("data-disabled");
			const forkWhy = await page.getByTestId("menu-fork-why").textContent();
			if (forkDisabled === null) {
				fails.push("fork item is not disabled on incident thread");
			}
			if (!forkWhy?.trim()) {
				fails.push("disabled fork item does not state why");
			}
			await page.keyboard.press("Escape");

			// 2. Destructive item confirms or offers Undo: create a fresh test thread
			const res = await page.request.post("/api/threads", {
				data: {
					subject: { kind: "none" },
					text: "Testing destructive actions",
				},
			});
			if (!res.ok()) {
				throw new Error(`failed to create test thread: ${await res.text()}`);
			}
			const { investigationId } = (await res.json()) as {
				investigationId: string;
			};

			await open(`/threads/${investigationId}`);
			await expect(page.getByTestId("thread-page")).toBeVisible();

			const menuBtn = page
				.locator("main")
				.getByTestId("thread-menu")
				.or(page.getByRole("button", { name: "Thread actions" }))
				.first();
			await expect(menuBtn).toBeVisible();

			// Test Archive offers Undo
			await menuBtn.click();
			const archiveItem = page.getByTestId("menu-archive");
			await expect(archiveItem).toBeVisible();
			await archiveItem.click();

			const archiveUndo = page.getByTestId("archive-undo");
			await expect(archiveUndo).toBeVisible();
			await archiveUndo.click();

			// Test Settle confirms or offers Undo
			await menuBtn.click();
			const settleItem = page.getByTestId("menu-settle");
			await expect(settleItem).toBeVisible();
			await settleItem.click();

			const hasDialog = await page
				.getByTestId("settle-dialog")
				.isVisible({ timeout: 2000 })
				.catch(() => false);
			if (hasDialog) {
				const confirmBtn = page.getByTestId("settle-confirm");
				await expect(confirmBtn).toBeVisible();
				await confirmBtn.click();
			}
			const settleUndo = page.getByTestId("settle-undo");
			await expect(settleUndo).toBeVisible();
			await settleUndo.click();

			return verdict(
				fails,
				`disabled item states why ("${forkWhy}"); Archive offers Undo; Settle confirms or offers Undo`,
			);
		},
	},
	{
		item: "20.4",
		async run({ page, open }) {
			const fails: string[] = [];
			const values: string[] = [];

			// Service: its card's menu holds its page's Edit and Delete, and Edit opens the page's dialog.
			// The sim seeds no service, so the check makes one and deletes it after.
			const made = await page.request.post("/api/services", {
				data: { name: `bar-20-4-${Date.now()}` },
			});
			expect(made.ok(), await made.text()).toBe(true);
			const { id: serviceId } = (await made.json()) as { id: string };
			try {
				await open("/services");
				const service = page.getByTestId("service-row").first();
				await expect(service).toBeVisible({ timeout: 30_000 });
				await service.click({ button: "right", position: { x: 4, y: 4 } });
				const serviceRows = await menuRows(page);
				for (const id of ["open", "edit", "delete", "link"])
					if (!serviceRows.includes(id))
						fails.push(`service row lacks ${id} (${serviceRows})`);
				await page.getByTestId("menu-edit").click();
				await expect(page.getByTestId("service-page")).toBeVisible();
				await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
				await page.keyboard.press("Escape");
				values.push(`service: ${serviceRows.join(", ")}`);
			} finally {
				await page.request.delete(`/api/services/${serviceId}`);
			}

			// Incident: the row holds what its page's menu holds.
			await open("/incidents?view=all");
			const incident = page.getByTestId("all-row").first();
			await expect(incident).toBeVisible({ timeout: 30_000 });
			await incident.click({ button: "right" });
			const incidentRows = await menuRows(page);
			await page.keyboard.press("Escape");
			await incident.click();
			await page.getByTestId("header-more").click();
			const header = await menuRows(page);
			await page.keyboard.press("Escape");
			// A run's own rows stay on its page, and so does the open thread's section that leads its menu.
			await open("/", "home");
			await page.getByTestId("thread-row").first().click({ button: "right" });
			const threadRows = await menuRows(page);
			await page.keyboard.press("Escape");
			const pageOnly = ["details", "runs", "export", "investigateAgain"];
			const missing = header.filter(
				(id) =>
					!pageOnly.includes(id) &&
					!threadRows.includes(id) &&
					!incidentRows.includes(id),
			);
			if (missing.length)
				fails.push(`incident row lacks its page's ${missing.join(", ")}`);
			values.push(`incident: ${incidentRows.join(", ")}`);

			// Alert: the same list on the card and on its page.
			await open("/alerts");
			const alert = page.getByTestId("alert-row").first();
			await expect(alert).toBeVisible({ timeout: 30_000 });
			await alert.click({ button: "right", position: { x: 4, y: 4 } });
			const alertRows = await menuRows(page);
			await page.keyboard.press("Escape");
			await page.getByTestId("alert-row-link").first().click();
			await page.getByTestId("alert-more").click();
			const alertHeader = await menuRows(page);
			await page.keyboard.press("Escape");
			const alertMissing = alertHeader.filter((id) => !alertRows.includes(id));
			if (alertMissing.length)
				fails.push(`alert row lacks its page's ${alertMissing.join(", ")}`);
			values.push(`alert: ${alertRows.join(", ")}`);

			return verdict(fails, values.join("; "));
		},
	},
]);
