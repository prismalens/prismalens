// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Steps for the @pr2 Settings, Alert sources, Services and picker journeys
 * (study-v3 §8). Scenes are set through the product's API; the fake agents
 * are swapped on PATH by the `agents` fixture, which puts them back.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import type { FakeAlertmanager } from "../../../../scripts/fakes/fake-alertmanager.mjs";
import { Given, Then, When } from "./fixtures";
import { ensureService, fireIncident, QUIET, visit } from "./product";

interface World {
	source?: string;
	incident?: string;
	/** The investigate request's body (#673 w52). */
	sent?: Record<string, unknown>;
}
const worlds = new WeakMap<Page, World>();
const w = (page: Page): World => {
	let x = worlds.get(page);
	if (!x) {
		x = {};
		worlds.set(page, x);
	}
	return x;
};
const repoRoot = () => join(process.cwd(), "..", "..");

// --- Shell and Back: a service ---------------------------------------------------------

async function openService(page: Page, name: string) {
	await page.goto("/services");
	await page
		.getByTestId("service-row")
		.filter({
			has: page.locator("[data-card-title]").getByText(name, { exact: true }),
		})
		.getByTestId("service-row-link")
		.click();
	await expect(page.getByTestId("service-page")).toBeVisible();
}

When(
	'I open Services, then "booklogr-api", and press the chevron',
	async ({ page }) => {
		await openService(page, "booklogr-api");
		await page.getByTestId("service-back").click();
	},
);

Then("I am on the services list", async ({ page }) => {
	await expect.poll(() => new URL(page.url()).pathname).toBe("/services");
	await expect(page.getByTestId("services-list")).toBeVisible();
});

When('I open "booklogr-api" again and press Escape', async ({ page }) => {
	await openService(page, "booklogr-api");
	await page.mouse.click(5, 5);
	await page.keyboard.press("Escape");
});

// --- Settings ----------------------------------------------------------------------

/**
 * Usage data through a route double, as `telemetry-consent.spec.ts` does: a
 * real opt-in would post to PostHog from a test, and CI forces it off. The
 * double answers an opt-in the way the server does, with setup_completed.
 */
async function serveTelemetry(page: Page) {
	const state = {
		enabled: false,
		forcedOff: false,
		noticed: true,
		dismissed: true,
		recentlySent: [] as { payload: Record<string, unknown> }[],
	};
	await page.route("**/api/settings/telemetry", async (route) => {
		if (route.request().method() === "PUT") {
			const { enabled } = route.request().postDataJSON() as {
				enabled: boolean;
			};
			if (enabled && !state.enabled && state.recentlySent.length === 0)
				state.recentlySent.unshift({
					payload: { event: "setup_completed", distinct_id: "install-id" },
				});
			Object.assign(state, { enabled });
		}
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(state),
		});
	});
}

When("I open Settings, Usage data", async ({ page }) => {
	await serveTelemetry(page);
	// Usage data is its own page; "usage" is the run usage charts (SETTINGS_SECTIONS, #1101).
	await page.goto("/settings?tab=telemetry");
	await expect(page.getByTestId("telemetry-row")).toBeVisible();
});

Then(
	'above the fold I see one switch "Share usage counts" whose hint names the install id, and a closed "What is sent" disclosure',
	async ({ page }) => {
		const height = page.viewportSize()?.height ?? 720;
		const row = page.getByTestId("telemetry-row");
		// A setting's sentence is its label's hint, never a line of its own (SettingRow, sheet §0.3).
		const about = row.getByTestId("setting-about");
		await expect(about).toHaveAttribute("aria-description", /install id/);
		await about.hover();
		await expect(page.getByTestId("hint").last()).toContainText("install id");
		const toggle = page.getByRole("switch", {
			name: "Share usage counts",
		});
		await expect(toggle).toHaveCount(1);
		const disclosure = page.getByTestId("telemetry-disclosure");
		await expect(disclosure).toContainText("What is sent");
		expect(
			await disclosure.evaluate((el) => (el as HTMLDetailsElement).open),
		).toBe(false);
		for (const el of [row, toggle, disclosure]) {
			const box = await el.boundingBox();
			expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height);
		}
	},
);

When("I open the disclosure", async ({ page }) => {
	await page.getByTestId("telemetry-disclosure").locator("summary").click();
});

Then(
	"I can read what is sent, what is never sent, the install id and consent, and retention",
	async ({ page }) => {
		const d = page.getByTestId("telemetry-disclosure");
		for (const words of [
			"What is sent",
			"What is never sent",
			"The install id",
			"How long it is kept",
		])
			await expect(d.getByText(words, { exact: true })).toBeVisible();
	},
);

When("I turn the switch on and reload", async ({ page }) => {
	await page.getByRole("switch", { name: "Share usage counts" }).click();
	await expect(
		page.getByRole("switch", { name: "Share usage counts" }),
	).toHaveAttribute("aria-checked", "true");
	await page.reload();
});

Then(
	'the switch is on and "Recently sent" lists the setup event',
	async ({ page }) => {
		await expect(
			page.getByRole("switch", { name: "Share usage counts" }),
		).toHaveAttribute("aria-checked", "true");
		await expect(
			page.getByTestId("telemetry-recent").getByTestId("telemetry-sent"),
		).toContainText("setup_completed");
	},
);

const SECTIONS = [
	"general",
	"appearance",
	"agent",
	"alert-intake",
	"sources",
	"notifications",
	"devices",
	"usage",
	"about",
];

When("I open each Settings section in turn", async () => {
	// The Then opens each one at both widths and reads it there.
});

Then(
	"a visual snapshot of each matches its approved render at 1440 and 390",
	async ({ page, $test, $testInfo }) => {
		// Fourteen loads and snapshots; on a CI runner that sits at the default 30 s.
		$test.slow();
		for (const width of [1440, 390]) {
			await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
			for (const tab of SECTIONS) {
				await visit(page, `/settings?tab=${tab}`);
				const frame = page.getByTestId("settings-frame");
				await expect(frame.locator("h2").first()).toBeVisible();
				await page.waitForTimeout(400);
				// One system: headings and rows, no framed box drawn inside a section.
				const boxed = await frame.evaluate((root) => {
					const skip =
						"input,textarea,select,button,[role=switch],code,kbd,pre,[role=dialog]";
					return Array.from(
						root.querySelectorAll<HTMLElement>("div,section,ul,li,p,dl"),
					)
						.filter((el) => !el.closest(skip))
						.filter((el) => {
							const s = getComputedStyle(el);
							const all = ["Top", "Right", "Bottom", "Left"].every(
								(side) =>
									Number.parseFloat(
										s.getPropertyValue(`border-${side.toLowerCase()}-width`),
									) > 0,
							);
							return all || (s.boxShadow !== "none" && s.boxShadow !== "");
						})
						.map((el) => el.outerHTML.slice(0, 120));
				});
				expect(boxed, `${tab} at ${width}`).toEqual([]);
				const overflow = await page.evaluate(
					() =>
						document.documentElement.scrollWidth -
						document.documentElement.clientWidth,
				);
				expect(overflow, `${tab} at ${width}`).toBeLessThanOrEqual(0);
				await $testInfo.attach(`settings-${tab}-${width}`, {
					body: await page.screenshot(),
					contentType: "image/png",
				});
			}
		}
	},
);

// --- Alert sources ------------------------------------------------------------------

const webhookToken = () =>
	readFileSync(
		join(
			process.env.PRISMALENS_E2E_WORKSPACE_DIR ?? "",
			"PRISMALENS_WEBHOOK_SECRET_FILE",
		),
		"utf8",
	).trim();

When("I open Settings, Alert intake", async ({ page }) => {
	await page.goto("/settings?tab=alert-intake");
	await expect(page.getByTestId("sources-webhook")).toBeVisible();
});

Then(
	'I see the Alertmanager webhook URL and a masked token with "Show" and "Copy"',
	async ({ page }) => {
		await expect(page.getByTestId("webhook-url")).toContainText(
			"/api/webhooks/prometheus",
		);
		const value = page.getByTestId("webhook-token-value");
		await expect(value).toContainText("…");
		await expect(value).not.toContainText(webhookToken());
		const row = page.getByTestId("webhook-token");
		await expect(row.getByRole("button", { name: "Show" })).toBeVisible();
		await expect(row.getByRole("button", { name: "Copy" })).toBeVisible();
	},
);

Then("the token is readable", async ({ page }) => {
	await expect(page.getByTestId("webhook-token-value")).toHaveText(
		webhookToken(),
	);
});

When(
	"an Alertmanager delivery arrives with that token as the bearer token",
	async ({ alertmanager, deliverWebhook, unique }) => {
		alertmanager.fire({
			labels: { alertname: unique("DeliveryCheck"), severity: "warning" },
		});
		await deliverWebhook();
	},
);

Then('"Last delivery" reads "1 alert, accepted"', async ({ page }) => {
	await expect(page.getByTestId("webhook-last-delivery")).toContainText(
		"1 alert, accepted",
		{ timeout: 15_000 },
	);
});

Then(
	'the kinds offered include "Alertmanager" and "Prometheus"',
	async ({ page }) => {
		const dialog = page.getByTestId("add-source-dialog");
		await expect(dialog.getByTestId("source-kind-alertmanager")).toBeVisible();
		await expect(dialog.getByTestId("source-kind-prometheus")).toBeVisible();
	},
);

When(
	"I choose Alertmanager, enter {string} and {string}, test it and save",
	async ({ page }, url: string, name: string) => {
		const dialog = page.getByTestId("add-source-dialog");
		await dialog.getByTestId("source-kind-alertmanager").click();
		await dialog.getByRole("button", { name: "Next" }).click();
		await dialog.getByTestId("source-url").fill(url);
		await dialog.getByTestId("source-name").fill(name);
		await dialog.getByTestId("source-credential-kind").click();
		await page.getByRole("option", { name: "No credential" }).click();
		await dialog.getByTestId("source-test").click();
		await expect(dialog.getByTestId("source-test-word")).toBeVisible({
			timeout: 20_000,
		});
		// Nothing answers there in the suite, so it saves untested (#848).
		const untested = dialog.getByTestId("source-save-untested");
		if (await untested.count()) await untested.click();
		else await dialog.getByTestId("source-save").click();
		await expect(dialog).toBeHidden({ timeout: 20_000 });
		w(page).source = name;
	},
);

Then(
	'a row {string} appears under "Pulled by URL" with its address and a state word',
	async ({ page }, name: string) => {
		const row = page
			.getByTestId("sources-pulled")
			.getByTestId("source-row")
			.filter({
				has: page.getByTestId("source-name").getByText(name, { exact: true }),
			})
			.first();
		await expect(row).toBeVisible();
		await expect(row.getByTestId("source-url")).toHaveText("127.0.0.1:9093");
		await expect(row.getByTestId("source-state")).toHaveText(
			/Connected|Not tested yet/,
		);
		await expect(row).toContainText("Also in Sources; editing it changes both");
	},
);

Then('there is no "Connections" section in Settings', async ({ page }) => {
	await expect(
		page.getByTestId("settings-sections").getByText("Connections"),
	).toHaveCount(0);
	// Leave no unreachable source behind for the scenarios after this one.
	const list = (await (
		await page.request.get("/api/integrations/connections")
	).json()) as {
		id: string;
		label: string;
	}[];
	for (const c of list.filter((x) => x.label === w(page).source))
		await page.request.delete(`/api/integrations/connections/${c.id}`);
});

// --- Services -----------------------------------------------------------------------

When("I open Services", async ({ page, unique }) => {
	const id = await ensureService(page, {
		name: unique("pr2-gateway"),
		type: "gateway",
		tier: "tier_2",
	});
	const added = await page.request.post("/api/repositories/source", {
		data: { serviceId: id, source: repoRoot() },
	});
	expect(added.ok(), await added.text()).toBe(true);
	await page.goto("/services");
	await expect(page.getByTestId("services-list")).toBeVisible();
});

Then(
	"each row shows the name, its health, its kind \\(Service, Database, Gateway, …), its code source as a folder path or host\\/owner\\/repo, and its open incidents",
	async ({ page, unique }) => {
		const rows = page.getByTestId("service-row");
		expect(await rows.count()).toBeGreaterThan(0);
		const KIND =
			/(Service|Database|Queue|Cache|Gateway|External|Infrastructure)( ·|$)/;
		for (const row of (await rows.all()).slice(0, 15)) {
			await expect(row.locator("[data-card-title]")).not.toBeEmpty();
			await expect(row.getByTestId("service-health")).toHaveAttribute(
				"aria-label",
				/^Health: (Nothing open|Degraded|Down|Stopped reporting)$/,
			);
			await expect(row.getByTestId("service-line")).toHaveText(KIND);
			await expect(row.getByTestId("service-open")).toHaveAttribute(
				"aria-label",
				/^Alert: (\d+ open|None open)$/,
			);
		}
		const mine = rows.filter({ hasText: unique("pr2-gateway") });
		await expect(mine.getByTestId("service-line")).toContainText("Gateway");
		// git reports the root with forward slashes on Windows too.
		await expect(mine.getByTestId("service-code")).toHaveAttribute(
			"aria-label",
			`Code: ${repoRoot().replace(/\\/g, "/")}`,
		);
	},
);

When('I open "booklogr-api"', async ({ page }) => {
	await ensureService(page, {
		name: "booklogr-api",
		displayName: "Booklogr API",
		type: "service",
		tier: "tier_1",
		team: "Booklogr team",
	});
	await openService(page, "booklogr-api");
});

Then(
	'I see "Code the run reads", "Connections", "Dependencies", "Runs" and "Incidents" on one page with no tabs',
	async ({ page }) => {
		const service = page.getByTestId("service-page");
		for (const title of [
			"Code the run reads",
			"Connections",
			"Dependencies",
			"Runs",
			"Incidents",
		])
			await expect(service.getByRole("heading", { name: title })).toBeVisible();
		await expect(service.getByRole("tablist")).toHaveCount(0);
		await expect(service.getByRole("tab")).toHaveCount(0);
	},
);

Then("the band shows the kind, tier and team", async ({ page }) => {
	const meta = page.getByTestId("service-band").getByTestId("service-meta");
	await expect(meta).toContainText("Service");
	await expect(meta).toContainText("Tier 1");
	await expect(meta).toContainText("Booklogr team");
});

When(
	"I add {string} as an upstream dependency",
	async ({ page }, other: string) => {
		await ensureService(page, {
			name: other,
			type: "database",
			tier: "tier_1",
		});
		await page.reload();
		await page.getByTestId("add-dependency").click();
		await page.getByTestId("dependency-service").click();
		await page.getByRole("option", { name: other, exact: true }).click();
		await page.getByTestId("dependency-direction-upstream").click();
		await page.getByTestId("dependency-save").click();
	},
);

Then(
	"it appears under {string} as {string}",
	async ({ page }, _section: string, words: string) => {
		const row = page
			.getByTestId("service-dependency-row")
			.filter({ hasText: "booklogr-db" });
		await expect(row.getByTestId("dependency-kind")).toHaveText(words);
	},
);

// --- Agent and model picker ------------------------------------------------------------

async function check(page: Page, id: string) {
	const res = await page.request.post("/api/settings/harness/check", {
		data: { id },
	});
	expect(res.ok(), await res.text()).toBe(true);
	const body = (await res.json()) as { outcome: string; detail: string };
	expect(body.outcome, body.detail).toBe("answers-acp");
}

async function openPicker(page: Page) {
	await page.goto("/settings?tab=models");
	await page.getByTestId("harness-run-row").getByTestId("agent-picker").click();
	await expect(page.getByTestId("agent-picker-list")).toBeVisible();
}

/** OpenCode and Codex as fakes that offer models and an effort, each checked once. */
async function pickerScene(
	page: Page,
	agents: { install: (b: string[], s: string) => void },
) {
	agents.install(["opencode"], "picker");
	agents.install(["codex-acp"], "codex");
	await check(page, "opencode");
	await check(page, "codex");
}

const picker = (page: Page) => page.getByTestId("agent-picker-list");

/**
 * A model's row in one group of the picker: cmdk keys each row by its group, a NUL, then
 * `<agent>::<model>` (kit PickerList), so the group starts the value and the model ends it.
 */
const row = (page: Page, group: string, agent: string, model: string) =>
	picker(page).locator(
		`[data-testid="model-option"][data-value^="${group}"][data-value$="${agent}::${model}"]`,
	);
/** Every model row under one group's heading. */
const groupRows = (page: Page, group: string) =>
	picker(page).locator(`[data-testid="model-option"][data-value^="${group}"]`);
const SONNET = "anthropic/claude-sonnet-5-5";

Given(
	"OpenCode, Claude Code and Codex are installed and deepagents is not",
	async ({ page, agents, $test }) => {
		await pickerScene(page, agents);
		const { harnesses } = (await (
			await page.request.get("/api/settings/harnesses")
		).json()) as {
			harnesses: { id: string; installed: boolean }[];
		};
		const on = Object.fromEntries(harnesses.map((h) => [h.id, h.installed]));
		$test.skip(on.deepagents === true, "deepagents is on this machine's PATH");
		expect([on.opencode, on["claude-code"], on.codex]).toEqual([
			true,
			true,
			true,
		]);
	},
);

When("I open the picker in Settings, Models", async ({ page }) => {
	await openPicker(page);
});

Then(
	"the list has one group per installed agent, headed by its name, and none for deepagents",
	async ({ page }) => {
		const headings = picker(page).locator("[cmdk-group-heading]");
		for (const name of ["OpenCode", "Claude Code", "Codex"])
			await expect(headings.filter({ hasText: name })).toHaveCount(1);
		// An agent that cannot run has no group (#907).
		await expect(headings.filter({ hasText: "deepagents" })).toHaveCount(0);
	},
);

Then(
	"OpenCode's group shows its models by their own names, no Default row, each named once",
	async ({ page }) => {
		const rows = groupRows(page, "OpenCode");
		await expect(rows.filter({ hasText: "Claude Sonnet 5.5" })).toHaveCount(1);
		await expect(
			rows.filter({ hasText: "DeepSeek V4.1 Flash (free)" }),
		).toHaveCount(1);
		// Every model by its real name; the word Default names none (#907).
		await expect(picker(page)).not.toContainText(/\bDefault\b/);
		const names = await rows.evaluateAll((els) =>
			els.map((e) => e.textContent?.trim()),
		);
		expect(new Set(names).size).toBe(names.length);
	},
);

When("I type {string} in the search", async ({ page }, text: string) => {
	await picker(page).getByTestId("picker-search").fill(text);
});

Then("only models matching {string} remain", async ({ page }, text: string) => {
	const rows = picker(page).getByTestId("model-option");
	await expect(rows.first()).toBeVisible();
	const names = await rows.evaluateAll((els) =>
		els.map((e) => e.textContent?.trim() ?? ""),
	);
	for (const n of names) expect(n.toLowerCase()).toContain(text.toLowerCase());
});

When("I star {string}", async ({ page }, name: string) => {
	expect(name).toBe("Claude Sonnet 5.5");
	const star = row(page, "OpenCode", "opencode", SONNET).getByTestId(
		"model-star",
	);
	await star.click();
	await expect(star).toHaveAttribute("aria-pressed", "true");
});

Then(
	"it is listed under Starred and first in OpenCode's group on the next open",
	async ({ page }) => {
		await page.keyboard.press("Escape");
		await expect(picker(page)).toBeHidden();
		await openPicker(page);
		await expect(row(page, "Starred", "opencode", SONNET)).toHaveCount(1);
		await expect(groupRows(page, "OpenCode").first()).toHaveAttribute(
			"data-value",
			new RegExp(`opencode::${SONNET}$`),
		);
	},
);

/** A draft on a fresh quiet incident, where the box's chips read the next run. */
async function openDraft(
	page: Page,
	fire: { alertmanager: FakeAlertmanager; deliverWebhook: () => Promise<void> },
	name: string,
) {
	const made = await fireIncident(
		page,
		fire.alertmanager,
		fire.deliverWebhook,
		{
			name,
			service: QUIET,
			quiet: true,
		},
	);
	await visit(page, `/incidents/${made.id}/conversation?investigation=new`);
	await expect(page.getByTestId("docked-composer")).toBeVisible();
}

async function pickAgent(page: Page, harness: string) {
	const res = await page.request.patch("/api/settings/harness", {
		data: { harness },
	});
	expect(res.ok(), await res.text()).toBe(true);
}

When(
	"I pick Codex and open a new run's draft",
	async ({ page, agents, alertmanager, deliverWebhook, unique }) => {
		await pickerScene(page, agents);
		await pickAgent(page, "codex");
		await openDraft(
			page,
			{ alertmanager, deliverWebhook },
			unique("PickerCodex"),
		);
	},
);

Then(
	/^the effort chip reads Codex's default "(.+)", and its menu tags it "(.+)"$/,
	async ({ page }, level: string, tag: string) => {
		const effort = page.getByTestId("effort-chip");
		await expect(effort).toContainText(level);
		await effort.click();
		const option = page.getByTestId("effort-option").filter({ hasText: level });
		await expect(page.getByTestId("effort-menu")).not.toContainText("Default");
		// A row's tag is its hint, shown on hover (kit Picker, #1101).
		await option.hover();
		await expect(page.getByTestId("hint").last()).toHaveText(tag);
		await page.keyboard.press("Escape");
	},
);

Then(
	'the model chip\'s list is the one Codex offers, with no "List its models"',
	async ({ page }) => {
		await page.getByTestId("agent-picker").click();
		// The check read Codex's own model option, so its list replaces the check line.
		await expect(row(page, "Codex", "codex", "gpt-5.6")).toHaveText("GPT-5.6");
		await expect(picker(page).getByTestId("model-pending")).toHaveCount(0);
		await page.keyboard.press("Escape");
	},
);

When(
	"I pick Claude Code and open a new run's draft",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		await pickAgent(page, "claude-code");
		await openDraft(
			page,
			{ alertmanager, deliverWebhook },
			unique("PickerClaude"),
		);
	},
);

// Effort is never hidden: an agent with no levels gets it locked with its reason (AgentPicker).
Then(
	"the effort chip is locked and says {string}",
	async ({ page }, why: string) => {
		const effort = page.getByTestId("effort-chip");
		await expect(effort).toHaveAttribute("data-locked", "");
		await effort.hover();
		await expect(page.getByTestId("hint").last()).toHaveText(why);
	},
);

Then(
	"every agent's access chip lists its own modes, or the four levels where it lists none, the one a run takes ticked",
	async ({ page }) => {
		for (const id of ["claude-code", "codex", "opencode"]) {
			await pickAgent(page, id);
			await page.reload();
			await expect(page.getByTestId("docked-composer")).toBeVisible();
			const chip = page.getByTestId("access-chip");
			await chip.click();
			const menu = page.getByTestId("access-menu");
			await expect(menu).toBeVisible();
			const modes = await page.request.get("/api/settings/harnesses");
			const listed = (
				(await modes.json()) as {
					harnesses: { id: string; checked?: { modes?: unknown[] } | null }[];
				}
			).harnesses.find((h) => h.id === id)?.checked?.modes?.length;
			await expect(menu.locator("[cmdk-item]")).toHaveCount(listed || 4);
			const ticked = menu.locator("[cmdk-item][data-on]");
			await expect(ticked).toHaveCount(1);
			expect((await chip.innerText()).trim()).toBe(
				(await ticked.innerText()).trim(),
			);
			await page.keyboard.press("Escape");
			await expect(menu).toBeHidden();
		}
		await pickAgent(page, "auto");
	},
);

Then("the access chip reads {string}", async ({ page }, text: string) => {
	await expect(page.getByTestId("access-chip")).toContainText(text);
});

When("I open the access chip", async ({ page }) => {
	await page.getByTestId("access-chip").click();
	await expect(page.getByTestId("access-menu")).toBeVisible();
});

Then(
	'the popover lists Codex\'s three modes with "Ask always" first and ticked',
	async ({ page }) => {
		// The chip is the agent's own modes, a mode a level runs named for it (agent-modes.ts).
		const options = page.getByTestId("access-menu").locator("[cmdk-item]");
		await expect(options).toHaveCount(3);
		const modes = ["read-only", "agent", "agent-full-access"];
		for (let i = 0; i < modes.length; i++)
			await expect(options.nth(i)).toHaveAttribute(
				"data-testid",
				`access-mode-${modes[i]}`,
			);
		await expect(options.first()).toHaveText("Ask always");
		await expect(options.first()).toHaveAttribute("data-on", "true");
	},
);

When("I pick {string} in the access menu", async ({ page }, level: string) => {
	const menu = page.getByTestId("access-menu");
	await menu.getByText(level, { exact: true }).click();
});

// --- A chip changes only this run (#673 w52) ------------------------------------------

async function harnessSettings(page: Page) {
	const res = await page.request.get("/api/settings/harness");
	expect(res.ok(), await res.text()).toBe(true);
	return (await res.json()) as {
		harness: string;
		models?: Record<string, string>;
		efforts?: Record<string, string>;
	};
}

Given(
	"OpenCode and Codex are checked and Settings names OpenCode",
	async ({ page, agents }) => {
		await pickerScene(page, agents);
		await pickAgent(page, "opencode");
	},
);

When(
	/^on a new run's draft I pick Codex's "(.+)" and "(.+)" effort in the box$/,
	async ({ page, alertmanager, deliverWebhook, unique }, model, level) => {
		await openDraft(page, { alertmanager, deliverWebhook }, unique("ChipRun"));
		w(page).incident = new URL(page.url()).pathname.split("/")[2];
		await page.getByTestId("agent-picker").click();
		// One list grouped by agent, no rail (#893): Codex's ids are its names in lower case.
		await row(page, "Codex", "codex", model.toLowerCase()).click();
		await expect(
			page.getByTestId("docked-composer").getByTestId("agent-picker"),
		).toHaveAttribute("aria-label", `Model: ${model}`);
		await page.getByTestId("effort-chip").click();
		await page.getByTestId("effort-option").filter({ hasText: level }).click();
		await expect(page.getByTestId("effort-chip")).toContainText(level);
	},
);

Then(
	"Settings still names OpenCode, with no model or effort for Codex",
	async ({ page }) => {
		const s = await harnessSettings(page);
		expect(s.harness).toBe("opencode");
		expect(s.models?.codex).toBeUndefined();
		expect(s.efforts?.codex).toBeUndefined();
	},
);

Then(
	/^the box still reads "(.+)" and "(.+)" after I open Alerts and come back$/,
	async ({ page }, model, level) => {
		// Alerts sits behind Automation (#1020): two steps there, two back.
		await page.getByTestId("nav-automation").click();
		await page.getByTestId("automation-alerts").click();
		await expect.poll(() => new URL(page.url()).pathname).toMatch(/\/alerts$/);
		await page.goBack();
		await page.goBack();
		await expect(page.getByTestId("docked-composer")).toBeVisible();
		await expect(
			page.getByTestId("docked-composer").getByTestId("agent-picker"),
		).toHaveAttribute("aria-label", `Model: ${model}`);
		await expect(page.getByTestId("effort-chip")).toContainText(level);
	},
);

When('I press "Investigate" in the box', async ({ page }) => {
	const sent = page.waitForRequest(
		(r) => r.method() === "POST" && /\/investigate$/.test(r.url()),
	);
	await page.getByTestId("composer-send").click();
	w(page).sent = (await sent).postDataJSON() as Record<string, unknown>;
});

Then(
	/^the run asks for Codex, "(.+)" and "(.+)", and keeps them on the run$/,
	async ({ page }, model, effort) => {
		expect(w(page).sent).toMatchObject({
			harness: "codex",
			model,
			effort,
		});
		await expect
			.poll(
				async () => {
					const res = await page.request.get(
						`/api/incidents/${w(page).incident}`,
					);
					const runs = (
						(await res.json()) as {
							investigations?: { id: string }[];
						}
					).investigations;
					if (!runs?.[0]) return null;
					const inv = (await (
						await page.request.get(`/api/investigations/${runs[0].id}`)
					).json()) as { harness?: string; model?: string; effort?: string };
					return { harness: inv.harness, model: inv.model, effort: inv.effort };
				},
				{ timeout: 30_000 },
			)
			.toEqual({ harness: "codex", model, effort });
		expect((await harnessSettings(page)).harness).toBe("opencode");
	},
);

Given(
	/^OpenCode offers "Claude Sonnet 5\.5" and "DeepSeek V4\.1 Flash \(free\)"$/,
	async ({ page, agents }) => {
		agents.install(["opencode"], "picker");
		await check(page, "opencode");
	},
);

When("I choose {string}", async ({ page }, name: string) => {
	expect(name).toBe("Claude Sonnet 5.5");
	await openPicker(page);
	await row(page, "OpenCode", "opencode", SONNET).click();
	await expect(picker(page)).toBeHidden();
});

Then(
	"the picker's chip, the Settings row and the box on an incident all read {string}",
	async ({ page, alertmanager, deliverWebhook, unique }, name: string) => {
		// The chip's name is its label; its text adds a short form for the phone (kit Picker).
		const settingsRow = page.getByTestId("harness-run-row");
		await expect(settingsRow.getByTestId("agent-picker")).toHaveAttribute(
			"aria-label",
			`Model: ${name}`,
		);
		const made = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("PickerBox"),
			service: QUIET,
			quiet: true,
		});
		w(page).incident = made.id;
		await page.goto(`/incidents/${made.id}/conversation`);
		await expect(
			page.getByTestId("docked-composer").getByTestId("agent-picker"),
		).toHaveAttribute("aria-label", `Model: ${name}`);
	},
);

Then(
	/^"DeepSeek V4\.1 Flash \(free\)" carries the warning "(.+)" and the picker ticks one model by its name, with no Default row$/,
	async ({ page }, warning: string) => {
		await openPicker(page);
		const free = row(
			page,
			"OpenCode",
			"opencode",
			"opencode/deepseek-v4.1-flash-free",
		);
		await expect(free.getByLabel(warning)).toBeVisible();
		// The chosen model is also the agent's star, so Starred ticks it too: one name either way.
		const ticked = picker(page).locator("[cmdk-item][data-on]");
		const names = await ticked.evaluateAll((els) =>
			els.map((e) => e.textContent?.trim()),
		);
		expect(new Set(names)).toEqual(new Set(["Claude Sonnet 5.5"]));
		await expect(picker(page)).not.toContainText(/\bDefault\b/);
	},
);

Then(
	"every row in an agent's group carries a mark, and searching an agent's name finds its models",
	async ({ page, agents }) => {
		await pickerScene(page, agents);
		await openPicker(page);
		for (const group of ["OpenCode", "Codex"]) {
			const rows = groupRows(page, group);
			await expect(rows.first()).toBeVisible();
			const marks = await rows.evaluateAll((els) =>
				els.map((e) => !!e.querySelector("svg, [data-letters]")),
			);
			expect(marks.every(Boolean)).toBe(true);
		}
		// A row's keywords hold its group, so the agent's name finds its models (kit PickerList).
		await picker(page).getByTestId("picker-search").fill("Codex");
		await expect(row(page, "Codex", "codex", "gpt-5.6")).toBeVisible();
		await expect(groupRows(page, "OpenCode")).toHaveCount(0);
		await page.keyboard.press("Escape");
	},
);

When(
	"I open the picker with a model starred on OpenCode and on Claude Code",
	async ({ page }) => {
		// One star per agent: its model when a run picks none (#907).
		const res = await page.request.patch("/api/settings/harness", {
			data: {
				models: { opencode: SONNET, "claude-code": "claude-opus-5-5" },
			},
		});
		expect(res.ok(), await res.text()).toBe(true);
		await openPicker(page);
	},
);

Then(
	"both are listed under Starred, each with its agent's mark",
	async ({ page }) => {
		await expect(
			row(page, "Starred", "opencode", SONNET).getByTestId("agent-logo"),
		).toHaveCount(1);
		await expect(
			row(page, "Starred", "claude-code", "claude-opus-5-5").locator(
				'[data-letters="CC"]',
			),
		).toHaveCount(1);
	},
);

// --- What Send does (#673 w59, #1020) ----------------------------------------------

Then(
	"the box's action reads {string} and {string} offers {string} alone",
	async ({ page }, verb: string, slash: string, other: string) => {
		const mode = page.getByTestId("composer-mode");
		await expect(mode).toHaveText(verb);
		await page.getByTestId("composer-input").fill(slash);
		// A command row reads as typed; a detail over five words is left out (commands.ts shortDetail).
		const command = page.getByTestId(`composer-slash-${other.slice(1)}`);
		await expect(command).toHaveText(other);
		await expect(
			page.getByTestId(`composer-slash-${verb.toLowerCase()}`),
		).toHaveCount(0);
	},
);

When(
	"I pick {string} under {string}",
	async ({ page }, command: string, _slash: string) => {
		await page.getByTestId(`composer-slash-${command.slice(1)}`).click();
		await expect(page.getByTestId("composer-slash")).toBeHidden();
		await expect(page.getByTestId("composer-mode")).toHaveAttribute(
			"data-mode",
			command.slice(1),
		);
	},
);

Then(
	"the box's one send control is the arrow and its placeholder reads {string}",
	async ({ page }, placeholder: string) => {
		await expect(page.getByTestId("composer-send")).toBeVisible();
		await expect(page.getByTestId("composer-input")).toHaveAttribute(
			"aria-label",
			placeholder,
		);
	},
);
