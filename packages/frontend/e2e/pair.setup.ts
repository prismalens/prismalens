// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Pairs the suite's browser the way the host's own browser pairs: an
 * operator link from `pl pair --operator` on the workspace a stack runs on,
 * opened on the /pair page, which redeems it with no click. The cookie it
 * leaves is the storage state every journey on that stack starts from. One
 * pairing per stack, since each worker has its own (playwright.config.ts).
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test as setup } from "@playwright/test";
import type { Stack } from "./stacks";

const stacks = JSON.parse(process.env.PRISMALENS_E2E_STACKS ?? "[]") as Stack[];

for (const stack of stacks) {
	setup(
		`pair this browser as the host of stack ${stack.index}`,
		async ({ browser }) => {
			setup.setTimeout(120_000);
			const context = await browser.newContext({ baseURL: stack.frontendURL });
			const page = await context.newPage();

			// A cold Vite optimises dependencies on the first page load and may reload
			// it; that reload must not land on /pair, which drops the one-time token.
			await page.goto("/");
			await page.waitForLoadState("networkidle");

			const out = execFileSync(
				"pnpm",
				[
					"--silent",
					"--filter",
					"prismalens",
					"dev",
					"pair",
					"--operator",
					"--workspace",
					stack.workspaceDir,
				],
				{ encoding: "utf8", shell: process.platform === "win32" },
			);
			const token = out.match(/\/pair#([^\s#]+)/)?.[1];
			expect(token, `no pairing link in:\n${out}`).toBeTruthy();

			await page.goto(`/pair#${token}`);
			await page.waitForURL(/\/incidents/);
			// The usage strip sits above the board and lands after it, moving every
			// card under a drag; telemetry-consent.spec serves its own flags (#673 w45).
			const seen = await page.request.put("/api/settings/telemetry", {
				data: { noticed: true, dismissed: true },
			});
			expect(seen.ok(), await seen.text()).toBe(true);
			await context.storageState({
				path: join(stack.workspaceDir, "paired-state.json"),
			});
			await context.close();
		},
	);
}
