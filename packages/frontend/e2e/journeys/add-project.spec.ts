// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Add project (#1020): one dialog for a folder or a git URL. The host browses its own
 * folders, never seeing a file name; a plain folder adds as Folder, and two picks inside
 * one repo add as two projects.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { expect, test } from "@playwright/test";

/** Each journey adds its own folders: one inside the checkout is another journey's project. */
function tree() {
	const root = mkdtempSync(join(tmpdir(), "pl-e2e-add-"));
	mkdirSync(join(root, "notes"));
	mkdirSync(join(root, "shop", "api"), { recursive: true });
	mkdirSync(join(root, "shop", "web"), { recursive: true });
	writeFileSync(join(root, "secret-plans.txt"), "x");
	execFileSync("git", ["init", "-q"], { cwd: join(root, "shop") });
	return root;
}

test.describe("#1020 — Add project", () => {
	test("browses folders only, and a plain folder adds as a Folder project", async ({
		page,
	}) => {
		const root = tree();
		await page.goto("/projects");
		await page.getByTestId("add-project").click();
		const dialog = page.getByTestId("add-project-dialog");
		await dialog.getByTestId("add-project-source").fill(`${root}${sep}`);
		const entries = dialog.getByTestId("add-project-entry");
		await expect(entries).toHaveText(["notes", "shop"]);
		await expect(dialog).not.toContainText("secret-plans");

		await entries.filter({ hasText: "notes" }).click();
		await expect(dialog.getByTestId("add-project-source")).toHaveValue(
			`${join(root, "notes")}${sep}`,
		);
		await expect(dialog.getByTestId("add-project-kind")).toHaveAttribute(
			"data-kind",
			"folder",
		);
		await dialog.getByTestId("add-project-submit").click();

		await expect(page.getByTestId("project-page")).toBeVisible();
		await expect(
			page.getByTestId("project-code").getByTestId("project-kind"),
		).toHaveAttribute("data-kind", "folder");
		await expect(page.getByTestId("project-start-git")).toBeVisible();
		await expect(page.getByTestId("make-service-needs-git")).toBeVisible();
		await expect(page.getByTestId("project-code")).not.toContainText(
			"not a git repository",
		);
	});

	test("two picks inside one repo make two projects", async ({ page }) => {
		const root = tree();
		const ids: string[] = [];
		for (const sub of ["api", "web"]) {
			await page.goto("/projects?add=1");
			const dialog = page.getByTestId("add-project-dialog");
			await dialog
				.getByTestId("add-project-source")
				.fill(join(root, "shop", sub));
			await expect(dialog.getByTestId("add-project-kind")).toHaveAttribute(
				"data-kind",
				"repo",
			);
			await dialog.getByTestId("add-project-submit").click();
			await expect(page.getByTestId("project-name")).toHaveText(`shop/${sub}`);
			ids.push(page.url().split("/projects/")[1] ?? "");
		}
		expect(ids[0]).not.toBe(ids[1]);
	});
});
