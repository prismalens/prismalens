// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * C6/C11 — Service → local checkout mapping (#331).
 *
 * Covers the surface that decides which code an investigation reads: the
 * unmapped warning, server-side rejection of a path that is not a git checkout,
 * a successful mapping that survives a reload, and clearing it again.
 *
 * The "valid path" is this repository's own checkout, resolved at runtime — a
 * hardcoded path would pass on one machine and fail on every other.
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
	cwd: resolve(HERE, "../.."),
	encoding: "utf8",
}).trim();

const API_GATEWAY = "/services/11111111-1111-4111-8111-111111111111";
const REPOSITORIES_TAB = `${API_GATEWAY}?tab=repositories`;

test.describe("C6 — service local checkout mapping", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(REPOSITORIES_TAB);
		await expect(
			page.getByRole("heading", { name: "Local checkout" }),
		).toBeVisible({ timeout: 15_000 });
	});

	test.afterEach(async ({ page }) => {
		// Leave the seeded service unmapped so the suite can run in any order.
		// WAIT for the clear to land — firing the click and closing the context
		// leaves the mapping set and the next test's Save button inert.
		await page.goto(REPOSITORIES_TAB);
		// Wait for the card to render first — probing straight after `goto` reads
		// an empty page, skips the cleanup, and leaks the mapping into the next test.
		await expect(
			page.getByRole("heading", { name: "Local checkout" }),
		).toBeVisible({ timeout: 15_000 });
		const clear = page.getByRole("button", { name: "Clear mapping" });
		if (await clear.isVisible().catch(() => false)) {
			await clear.click();
			await expect(
				page.getByText("No local checkout mapped", { exact: false }),
			).toBeVisible({ timeout: 15_000 });
		}
	});

	test("an unmapped service warns that investigations run unmapped", async ({
		page,
	}) => {
		await expect(
			page.getByText("No local checkout mapped", { exact: false }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Clear mapping" }),
		).toHaveCount(0);
	});

	test("a path that does not exist is refused with a reason", async ({
		page,
	}) => {
		await page
			.getByLabel("Checkout path")
			.fill("/definitely/not/a/real/path/331");
		await page.getByRole("button", { name: "Check", exact: true }).click();

		await expect(
			page.getByText("does not exist on this machine", { exact: false }),
		).toBeVisible({ timeout: 15_000 });
	});

	test("a directory that is not a git checkout is refused", async ({
		page,
	}) => {
		// `/tmp` exists and is a directory, so this isolates the git check itself.
		await page.getByLabel("Checkout path").fill("/tmp");
		await page.getByRole("button", { name: "Check", exact: true }).click();

		await expect(
			page.getByText("is not a git checkout", { exact: false }),
		).toBeVisible({ timeout: 15_000 });
	});

	test("a relative path is refused before it reaches the filesystem", async ({
		page,
	}) => {
		await page.getByLabel("Checkout path").fill("packages/api");
		await page.getByRole("button", { name: "Check", exact: true }).click();

		await expect(
			page.getByText("is not an absolute path", { exact: false }),
		).toBeVisible({ timeout: 15_000 });
	});

	test("a real git checkout validates, saves, and survives a reload", async ({
		page,
	}) => {
		await page.getByLabel("Checkout path").fill(REPO_ROOT);
		await page.getByRole("button", { name: "Check", exact: true }).click();
		await expect(
			page.getByText("Valid git checkout", { exact: false }),
		).toBeVisible({ timeout: 15_000 });

		await page.getByRole("button", { name: "Save checkout" }).click();
		await expect(
			page.getByText("Investigations for this service will run in this checkout", {
				exact: false,
			}),
		).toBeVisible({ timeout: 15_000 });

		// The mapping is persisted, not just held in component state.
		await page.reload();
		await expect(page.getByLabel("Checkout path")).toHaveValue(REPO_ROOT, {
			timeout: 15_000,
		});
		await expect(
			page.getByText("No local checkout mapped", { exact: false }),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Clear mapping" }),
		).toBeVisible();
	});

	test("clearing the mapping returns the service to the unmapped warning", async ({
		page,
	}) => {
		await page.getByLabel("Checkout path").fill(REPO_ROOT);
		await page.getByRole("button", { name: "Save checkout" }).click();
		await expect(
			page.getByRole("button", { name: "Clear mapping" }),
		).toBeVisible({ timeout: 15_000 });

		await page.getByRole("button", { name: "Clear mapping" }).click();
		await page.reload();
		await expect(
			page.getByText("No local checkout mapped", { exact: false }),
		).toBeVisible({ timeout: 15_000 });
	});
});
