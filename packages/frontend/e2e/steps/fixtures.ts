// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test as base, createBdd } from "playwright-bdd";
import {
	installFakeAgent,
	releaseDir,
	releaseRun,
} from "../../../../scripts/fakes/fake-acp-agent.mjs";
import {
	type FakeAlertmanager,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";
import { hideQueryDevtools } from "../journeys/live-stream-fixtures";

interface Fixtures {
	alertmanager: FakeAlertmanager;
	/** Delivers what Alertmanager lists to the app's real webhook, with the workspace's token; `only` narrows it. */
	deliverWebhook: (only?: string[]) => Promise<void>;
	/** Alert names are unique per scenario so parallel scenarios never see each other's. */
	unique: (name: string) => string;
	/** The fake agents on the servers' PATH; put back as they were after the scenario. */
	agents: {
		/** Installs the fake under more binary names, replaying `session`. */
		install: (binaries: string[], session: string) => void;
		/** Takes the default fakes off PATH. */
		hide: () => void;
	};
	/** Lets a run the `live` session holds go on to its report. */
	release: (key: string) => void;
	/** Holds runs for `key` again, after a release. */
	hold: (key: string) => void;
}

const DEFAULT_AGENTS = ["opencode", "claude-agent-acp"];
const workspace = () => process.env.PRISMALENS_E2E_WORKSPACE_DIR ?? "";
const binDir = () => join(workspace(), "harness-bin");
// This stack's fakes keep their state here, apart from other workers' (playwright.config.ts).
const fakeAgentStateDir = () => join(workspace(), "fake-agent-state");

export const test = base.extend<Fixtures>({
	page: async ({ page }, use) => {
		await hideQueryDevtools(page);
		await use(page);
		// A release names a title; later prompts quote past titles, so none outlive the scenario.
		rmSync(releaseDir(fakeAgentStateDir()), { recursive: true, force: true });
		// A held run never ends on its own; left running it would take a slot of the
		// dispatch cap from every scenario after this one.
		for (const status of ["running", "pending"]) {
			const res = await page.request
				.get(`/api/investigations?status=${status}&limit=100`)
				.catch(() => null);
			if (!res?.ok()) continue;
			const { data } = (await res.json()) as { data: { id: string }[] };
			for (const run of data)
				await page.request
					.post(`/api/investigations/${run.id}/cancel`)
					.catch(() => null);
		}
		await page.request
			.patch("/api/settings/harness", {
				data: {
					accessLevels: { opencode: null, "claude-code": null, codex: null },
					autoAccessLevels: {
						opencode: null,
						"claude-code": null,
						codex: null,
					},
				},
			})
			.catch(() => null);
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
		await use(async (only?: string[]) => {
			const res = await alertmanager.post(
				`${baseURL}/api/webhooks/prometheus`,
				token,
				only ? { only } : undefined,
			);
			if (!res.ok)
				throw new Error(`webhook answered ${res.status}: ${await res.text()}`);
		});
	},
	agents: async ({ page }, use) => {
		const extra = new Set<string>();
		let hidden = false;
		let changed = false;
		await use({
			install: (binaries, session) => {
				for (const b of binaries) if (!DEFAULT_AGENTS.includes(b)) extra.add(b);
				changed = true;
				installFakeAgent(binDir(), {
					binaries,
					session,
					stateDir: fakeAgentStateDir(),
				});
			},
			hide: () => {
				hidden = true;
				for (const b of DEFAULT_AGENTS)
					for (const f of [b, `${b}.cmd`])
						renameSync(join(binDir(), f), join(binDir(), `${f}.hidden`));
			},
		});
		if (hidden)
			for (const b of DEFAULT_AGENTS)
				for (const f of [b, `${b}.cmd`])
					renameSync(join(binDir(), `${f}.hidden`), join(binDir(), f));
		for (const b of Array.from(extra))
			for (const f of [b, `${b}.cmd`])
				rmSync(join(binDir(), f), { force: true });
		if (changed) {
			installFakeAgent(binDir(), {
				session: "success",
				stateDir: fakeAgentStateDir(),
			});
			// What a scenario chose in the picker is not the next scenario's choice.
			await page.request.patch("/api/settings/harness", {
				data: {
					harness: "auto",
					models: { opencode: null, "claude-code": null, codex: null },
					accessLevels: { opencode: null, "claude-code": null, codex: null },
					autoAccessLevels: {
						opencode: null,
						"claude-code": null,
						codex: null,
					},
					favourites: [],
				},
			});
		}
	},
	// biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this pattern.
	release: async ({}, use) => {
		await use((key) => releaseRun(key, fakeAgentStateDir()));
	},
	// biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this pattern.
	hold: async ({}, use) => {
		await use((key) =>
			rmSync(join(releaseDir(fakeAgentStateDir()), encodeURIComponent(key)), {
				force: true,
			}),
		);
	},
	// biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this pattern.
	unique: async ({}, use, testInfo) => {
		const stamp = `${Date.now().toString(36)}${testInfo.workerIndex}`;
		await use((name) => `${name}-${stamp}`);
	},
});

export const { Given, When, Then } = createBdd(test);
