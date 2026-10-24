// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";

/** An Alertmanager whose `/-/ready` answers whatever the test last set. */
async function readyServer(): Promise<{
	url: string;
	setStatus: (s: number) => void;
	close: () => Promise<void>;
}> {
	let status = 200;
	const server: Server = createServer((_req, res) => {
		res.writeHead(status);
		res.end();
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		setStatus: (s) => {
			status = s;
		},
		close: () =>
			new Promise((r) => {
				server.closeAllConnections();
				server.close(() => r());
			}),
	};
}

test.describe("Sources, a pulled Alertmanager row (#781 review, #848)", () => {
	test("Test refreshes the row's state, and Delete asks first and survives a failure", async ({
		page,
	}) => {
		const am = await readyServer();
		const name = `Row check ${Date.now()}`;
		try {
			const saved = await page.request.post("/api/sources/connect", {
				data: { type: "alertmanager", url: am.url, label: name },
			});
			expect(saved.ok(), await saved.text()).toBe(true);
			await page.goto("/settings?tab=sources");

			const row = page.getByTestId("source-row").filter({
				has: page.getByTestId("source-name").getByText(name, { exact: true }),
			});
			await expect(row.getByTestId("source-state")).toHaveText("Connected");
			await row.getByRole("button", { expanded: false }).click();

			am.setStatus(503);
			await row.getByRole("button", { name: "Test" }).click();
			await expect(row.getByTestId("source-state")).not.toHaveText("Connected");
			await expect(row).toContainText("Alertmanager answered 503");

			await row.getByRole("button", { name: "Delete" }).click();
			const confirm = page.getByRole("alertdialog");
			await expect(confirm).toContainText("Delete connection?");
			await confirm.getByRole("button", { name: "Cancel" }).click();
			await expect(row).toHaveCount(1);

			// A failed delete keeps the dialog open with the error inside it.
			const deleteRoute = (url: URL) =>
				url.pathname.startsWith("/api/integrations/connections/");
			await page.route(deleteRoute, (route) =>
				route.request().method() === "DELETE"
					? route.fulfill({
							status: 409,
							contentType: "application/json",
							body: JSON.stringify({
								defined: false,
								code: "CONFLICT",
								status: 409,
								message: "Connection is in use",
							}),
						})
					: route.fallback(),
			);
			await row.getByRole("button", { name: "Delete" }).click();
			await confirm.getByRole("button", { name: "Delete" }).click();
			await expect(confirm).toBeVisible();
			await expect(confirm.getByRole("alert")).toContainText(
				"Connection is in use",
			);
			await expect(row).toHaveCount(1);
			await page.unroute(deleteRoute);

			await confirm.getByRole("button", { name: "Delete" }).click();
			await expect(confirm).toBeHidden();
			await expect(row).toHaveCount(0);
		} finally {
			const list = (await (
				await page.request.get("/api/integrations/connections")
			).json()) as { id: string; label: string }[];
			for (const c of list.filter((x) => x.label === name))
				await page.request.delete(`/api/integrations/connections/${c.id}`);
			await am.close();
		}
	});
});
