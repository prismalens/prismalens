// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Pairs the suite's browser the way the host's own browser pairs: an
 * operator link from `pl pair --operator` on the workspace the servers run
 * on, opened on the /pair page, which redeems it with no click. The cookie it leaves is the
 * storage state every journey starts from.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test as setup } from "@playwright/test";

setup("pair this browser as the host", async ({ page }) => {
	const workspaceDir = process.env.PRISMALENS_E2E_WORKSPACE_DIR;
	if (!workspaceDir) throw new Error("PRISMALENS_E2E_WORKSPACE_DIR is unset");

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
			workspaceDir,
		],
		{ encoding: "utf8", shell: process.platform === "win32" },
	);
	const token = out.match(/\/pair#([^\s#]+)/)?.[1];
	expect(token, `no pairing link in:\n${out}`).toBeTruthy();

	await page.goto(`/pair#${token}`);
	await page.waitForURL(/\/incidents/);
	await page
		.context()
		.storageState({ path: join(workspaceDir, "paired-state.json") });
});
