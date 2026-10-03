// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, createBdd } from "playwright-bdd";
import {
	type FakeAlertmanager,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";
import { hideQueryDevtools } from "../journeys/live-stream-fixtures";

interface Fixtures {
	alertmanager: FakeAlertmanager;
	/** Delivers what Alertmanager lists to the app's real webhook, with the workspace's token. */
	deliverWebhook: () => Promise<void>;
	/** Alert names are unique per scenario so parallel scenarios never see each other's. */
	unique: (name: string) => string;
}

export const test = base.extend<Fixtures>({
	page: async ({ page }, use) => {
		await hideQueryDevtools(page);
		await use(page);
	},
	// biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this pattern.
	alertmanager: async ({}, use) => {
		const am = await startFakeAlertmanager();
		await use(am);
		await am.close();
	},
	deliverWebhook: async ({ alertmanager, baseURL }, use) => {
		const workspace = process.env.PRISMALENS_E2E_WORKSPACE_DIR ?? "";
		const token = readFileSync(
			join(workspace, "PRISMALENS_WEBHOOK_SECRET_FILE"),
			"utf8",
		).trim();
		await use(async () => {
			const res = await alertmanager.post(
				`${baseURL}/api/webhooks/prometheus`,
				token,
			);
			if (!res.ok)
				throw new Error(`webhook answered ${res.status}: ${await res.text()}`);
		});
	},
	// biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this pattern.
	unique: async ({}, use, testInfo) => {
		const stamp = `${Date.now().toString(36)}${testInfo.workerIndex}`;
		await use((name) => `${name}-${stamp}`);
	},
});

export const { Given, When, Then } = createBdd(test);
