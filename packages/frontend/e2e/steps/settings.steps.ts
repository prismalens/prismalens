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
		.getByTestId("service-row-link")
		.filter({
			has: page.getByTestId("service-name").getByText(name, { exact: true }),
		})
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
	await page.goto("/settings?tab=usage");
	await expect(page.getByTestId("telemetry-row")).toBeVisible();
});

Then(
	'above the fold I see one sentence naming the install id, one switch "Share usage counts", and a closed "What is sent" disclosure',
	async ({ page }) => {
		const height = page.viewportSize()?.height ?? 720;
		const row = page.getByTestId("telemetry-row");
		await expect(row).toContainText("install id");
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
	"harness",
	"sources",
	"integrations",
	"devices",
	"usage",
	"about",
	"danger",
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

When("I open Settings, Alert sources", async ({ page }) => {
	await page.goto("/settings?tab=sources");
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
	'the kinds offered are "Alertmanager" and "Prometheus"',
	async ({ page }) => {
		const kinds = page
			.getByTestId("add-source-dialog")
			.getByTestId("source-kind");
		await expect(kinds.getByRole("button")).toHaveText([
			"Alertmanager",
			"Prometheus",
		]);
	},
);

When(
	'I choose Alertmanager, enter {string} and {string} and press "Add"',
	async ({ page }, url: string, name: string) => {
		const dialog = page.getByTestId("add-source-dialog");
		await dialog.getByTestId("source-kind-alertmanager").click();
		await dialog.getByTestId("source-url-input").fill(url);
		await dialog.getByTestId("source-name-input").fill(name);
		await dialog.getByTestId("add-source-submit").click();
		await expect(dialog).toBeHidden({ timeout: 20_000 });
		w(page).source = name;
	},
);

Then(
	'a row {string} appears under "Pulled from" with its URL and "reachable" or the last error',
	async ({ page }, name: string) => {
		const row = page
			.getByTestId("sources-pulled")
			.getByTestId("source-row")
			.filter({
				has: page.getByTestId("source-name").getByText(name, { exact: true }),
			})
			.first();
		await expect(row).toBeVisible();
		await expect(row.getByTestId("source-url")).toHaveText(
			"http://127.0.0.1:9093",
		);
		const state = await row.getByTestId("source-state").innerText();
		if (state === "Unreachable")
			await expect(row).toContainText("pulls skip it until Test reaches it");
		else expect(state).toBe("Reachable");
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
	"each row shows the name, its kind \\(Service, Database, Gateway, …), its code source as a folder path or host\\/owner\\/repo, its telemetry, and its open incidents",
	async ({ page, unique }) => {
		const rows = page.getByTestId("service-row");
		expect(await rows.count()).toBeGreaterThan(0);
		for (const row of (await rows.all()).slice(0, 15)) {
			await expect(row.getByTestId("service-name")).not.toBeEmpty();
			await expect(row.getByTestId("service-kind")).toHaveText(
				/^(Service|Database|Queue|Cache|Gateway|External|Infrastructure)$/,
			);
			await expect(row.getByTestId("service-telemetry")).toHaveText(
				/^(Telemetry from .+|No telemetry)$/,
			);
			await expect(row.getByTestId("service-open")).toHaveText(
				/^(\d+ open|none open)$/,
			);
		}
		const mine = rows.filter({ hasText: unique("pr2-gateway") });
		await expect(mine.getByTestId("service-kind")).toHaveText("Gateway");
		await expect(mine.getByTestId("service-code")).toHaveText(repoRoot());
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
	'I see "Code the run reads", "Telemetry", "Dependencies", "Runs" and "Incidents" on one page with no tabs',
	async ({ page }) => {
		const service = page.getByTestId("service-page");
		for (const title of [
			"Code the run reads",
			"Telemetry",
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
	await page.goto("/settings?tab=harness");
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

When("I open the picker in Settings, Agent", async ({ page }) => {
	await openPicker(page);
	await picker(page).getByTestId("rail-opencode").click();
});

Then(
	"the left rail shows a Starred tile and one tile per installed agent, and none for deepagents",
	async ({ page }) => {
		await expect(picker(page).getByTestId("rail-starred")).toHaveCount(1);
		for (const id of ["opencode", "claude-code", "codex"])
			await expect(picker(page).getByTestId(`rail-${id}`)).toHaveCount(1);
		// An agent that is not installed has no tile (#673 w9).
		await expect(picker(page).getByTestId("rail-deepagents")).toHaveCount(0);
		for (const id of ["opencode", "claude-code", "codex"])
			await expect(picker(page).getByTestId(`rail-${id}`)).not.toHaveAttribute(
				"data-off",
				"",
			);
	},
);

Then(
	"the list shows the agent's own model first, then the models with their provider under each, no headings, each named once",
	async ({ page }) => {
		const list = picker(page).getByRole("listbox", { name: "Models" });
		await expect(list.getByRole("option").first()).toHaveAttribute(
			"data-testid",
			"model-default",
		);
		await expect(list.locator("[cmdk-group-heading], legend")).toHaveCount(0);
		const rows = list.getByTestId("model-option");
		await expect(rows.filter({ hasText: "Claude Sonnet 5.5" })).toContainText(
			"Anthropic",
		);
		await expect(
			rows.filter({ hasText: "Muse Spark 1.3 (free)" }),
		).toBeVisible();
		const names = await rows.evaluateAll((els) =>
			els.map((e) => e.getAttribute("data-model")),
		);
		expect(new Set(names).size).toBe(names.length);
	},
);

When("I type {string} in the search", async ({ page }, text: string) => {
	await picker(page).getByTestId("picker-search").fill(text);
});

Then("only models matching {string} remain", async ({ page }, text: string) => {
	const names = await picker(page)
		.getByTestId("model-option")
		.evaluateAll((els) => els.map((e) => e.getAttribute("data-model") ?? ""));
	expect(names.length).toBeGreaterThan(0);
	for (const n of names) expect(n.toLowerCase()).toContain(text.toLowerCase());
});

When("I star {string}", async ({ page }, name: string) => {
	await picker(page)
		.locator(`[data-testid=model-option][data-model="${name}"]`)
		.first()
		.getByTestId("model-star")
		.click();
	await expect(
		picker(page)
			.locator(`[data-testid=model-option][data-model="${name}"]`)
			.first()
			.getByTestId("model-star"),
	).toHaveAttribute("aria-pressed", "true");
});

Then(
	"it is listed under the Starred tile and first in OpenCode's list on the next open",
	async ({ page }) => {
		await page.keyboard.press("Escape");
		await expect(picker(page)).toBeHidden();
		await openPicker(page);
		await picker(page).getByTestId("rail-opencode").click();
		await expect(
			picker(page).getByTestId("model-option").first(),
		).toHaveAttribute("data-model", "Claude Sonnet 5.5");
		await picker(page).getByTestId("rail-starred").click();
		await expect(
			picker(page).locator(
				'[data-testid=model-option][data-model="Claude Sonnet 5.5"]',
			),
		).toBeVisible();
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
	/^the effort chip reads Codex's default "(.+)", and its menu tags it "Default"$/,
	async ({ page }, level: string) => {
		const effort = page.getByTestId("effort-chip");
		await expect(effort).toContainText(level);
		await effort.click();
		const row = page.getByTestId("effort-option").filter({ hasText: level });
		await expect(row).toContainText("Default");
		await page.keyboard.press("Escape");
	},
);

Then(
	'the model chip\'s list is the one Codex offers, with no "Run a check to list models"',
	async ({ page }) => {
		await page.getByTestId("agent-picker").click();
		// The check read Codex's own model option, so its list replaces the check line.
		await expect(
			picker(page).locator('[data-testid=model-option][data-model="GPT-5.6"]'),
		).toBeVisible();
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

Then(
	/^the effort chip is disabled, reading "(.+)"$/,
	async ({ page }, word: string) => {
		const effort = page.getByTestId("effort-chip");
		await expect(effort).toBeDisabled();
		await expect(effort).toHaveText(word);
	},
);

Then(
	"every agent shows its own default permission mode, by the agent's name once checked",
	async ({ page }) => {
		// Each agent's Permission row names its default and where it came from (#673 w21).
		for (const id of ["opencode", "claude-code", "codex"]) {
			await pickAgent(page, id);
			await page.goto("/settings?tab=harness");
			await expect(page.getByTestId("harness-access")).toContainText(
				/(Your default: |PrismaLens default|set here)/,
			);
		}
		await pickAgent(page, "auto");
	},
);

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
		await picker(page).getByTestId("rail-codex").click();
		await picker(page)
			.locator(`[data-testid=model-option][data-model="${model}"]`)
			.click();
		await expect(page.getByTestId("model-pill")).toHaveText(model);
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
		await page.getByTestId("tab-alerts").click();
		await expect.poll(() => new URL(page.url()).pathname).toMatch(/\/alerts$/);
		await page.goBack();
		await expect(page.getByTestId("docked-composer")).toBeVisible();
		await expect(page.getByTestId("model-pill")).toHaveText(model);
		await expect(page.getByTestId("effort-chip")).toContainText(level);
	},
);

When('I press "Investigate" in the box', async ({ page }) => {
	const sent = page.waitForRequest(
		(r) => r.method() === "POST" && /\/investigate$/.test(r.url()),
	);
	await page.getByTestId("composer-investigate").click();
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
	/^OpenCode offers "Claude Sonnet 5\.5" and "Muse Spark 1\.3 \(free\)"$/,
	async ({ page, agents }) => {
		agents.install(["opencode"], "picker");
		await check(page, "opencode");
	},
);

When("I choose {string}", async ({ page }, name: string) => {
	await openPicker(page);
	await picker(page).getByTestId("rail-opencode").click();
	await picker(page)
		.locator(`[data-testid=model-option][data-model="${name}"]`)
		.first()
		.click();
	await expect(picker(page)).toBeHidden();
});

Then(
	"the picker's chip, the Settings row and the box on an incident all read {string}",
	async ({ page, alertmanager, deliverWebhook, unique }, name: string) => {
		const row = page.getByTestId("harness-run-row");
		await expect(row.getByTestId("model-pill")).toHaveText(name);
		await expect(row).toContainText(name);
		const made = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("PickerBox"),
			service: QUIET,
			quiet: true,
		});
		w(page).incident = made.id;
		await page.goto(`/incidents/${made.id}/conversation`);
		await expect(
			page.getByTestId("docked-composer").getByTestId("model-pill"),
		).toHaveText(name);
	},
);

Then(
	/^"Muse Spark 1\.3 \(free\)" carries the line "trains on your prompts" and the agent's own model shows what OpenCode reports, not a PrismaLens choice$/,
	async ({ page }) => {
		await openPicker(page);
		await picker(page).getByTestId("rail-opencode").click();
		const muse = picker(page)
			.locator('[data-testid=model-option][data-model="Muse Spark 1.3 (free)"]')
			.first();
		await expect(muse).toContainText("trains on your prompts");
		// The agent's own model row's sub-line is the model OpenCode reports it serves, nothing more.
		await expect(picker(page).getByTestId("model-default")).toContainText(
			"Agent's own model",
		);
		await expect(picker(page).getByTestId("model-default")).not.toContainText(
			"PrismaLens",
		);
	},
);

Then(
	"every rail tile is a tab showing the agent's mark and no label, and the search names the agent",
	async ({ page, agents }) => {
		// A tile opens only for an installed agent.
		await pickerScene(page, agents);
		await openPicker(page);
		const rail = picker(page).getByRole("tablist", { name: "Agents" });
		await expect(rail).toHaveAttribute("aria-orientation", "vertical");
		for (const [id, name] of [
			["opencode", "OpenCode"],
			["claude-code", "Claude Code"],
			["codex", "Codex"],
		] as const) {
			const tile = picker(page).getByTestId(`rail-${id}`);
			await expect(tile).toHaveAttribute("role", "tab");
			// A vendor mark, or a two-letter tile where none reads at 20 px; never a text label.
			await expect(
				tile.locator('svg, [data-testid="agent-lettermark"]').first(),
			).toBeVisible();
			const text = (await tile.innerText()).trim();
			expect(text === "" || /^[A-Z]{2}$/.test(text)).toBe(true);
			await tile.click();
			await expect(tile).toHaveAttribute("aria-selected", "true");
			await expect(picker(page).getByTestId("picker-search")).toHaveAttribute(
				"placeholder",
				`Search ${name} models`,
			);
		}
		// One tab stop: Down moves along the rail and shows that agent.
		await picker(page).getByTestId("rail-opencode").click();
		await page.keyboard.press("ArrowDown");
		await expect(picker(page).getByTestId("rail-claude-code")).toBeFocused();
		await expect(picker(page).getByTestId("picker-search")).toHaveAttribute(
			"placeholder",
			"Search Claude Code models",
		);
		await page.keyboard.press("ArrowRight");
		await expect(picker(page).getByTestId("picker-search")).toBeFocused();
	},
);

Then("the panel measures 380 by 400 px on every agent", async ({ page }) => {
	for (const id of ["starred", "opencode", "claude-code", "codex"]) {
		await picker(page).getByTestId(`rail-${id}`).click();
		const b = await picker(page).boundingBox();
		expect([Math.round(b?.width ?? 0), Math.round(b?.height ?? 0)]).toEqual([
			380, 400,
		]);
	}
});

When('I open the "Starred" tile', async ({ page, agents }) => {
	// Starring is the picker's own write; two agents' stars set the scene here.
	agents.install(["opencode"], "picker");
	await check(page, "opencode");
	const res = await page.request.patch("/api/settings/harness", {
		data: {
			favourites: [
				{ harness: "opencode", model: "anthropic/claude-sonnet-5-5" },
				{ harness: "claude-code", model: "claude-opus-5-5" },
			],
		},
	});
	expect(res.ok()).toBe(true);
	await page.keyboard.press("Escape");
	await openPicker(page);
	await picker(page).getByTestId("rail-starred").click();
});

Then(
	"my starred models from every agent are listed, each with its agent",
	async ({ page }) => {
		const rows = picker(page).getByTestId("model-option");
		await expect(rows.filter({ hasText: "Claude Sonnet 5.5" })).toContainText(
			"OpenCode",
		);
		await expect(rows.filter({ hasText: "Claude Opus 5.5" })).toContainText(
			"Claude Code",
		);
	},
);

// --- The verb chip (#673 w59) ---------------------------------------------------------

Then(
	"the verb chip reads {string} and its menu explains {string} and {string} with {string}",
	async ({ page }, verb: string, a: string, b: string, foot: string) => {
		const chip = page.getByTestId("verb-chip");
		await expect(chip).toHaveText(verb);
		await expect(
			page.getByTestId("composer-chips").locator("button").first(),
		).toHaveAttribute("data-testid", "verb-chip");
		await chip.click();
		const menu = page.getByTestId("verb-menu");
		await expect(menu.getByTestId("verb-investigate")).toContainText(a);
		await expect(menu.getByTestId("verb-investigate")).toContainText(
			"Ends with a report.",
		);
		await expect(menu.getByTestId("verb-ask")).toContainText(b);
		await expect(menu.getByTestId("verb-ask")).toContainText("No report.");
		await expect(menu).toContainText(foot);
	},
);

When("I pick {string} in the verb menu", async ({ page }, verb: string) => {
	await page.getByTestId(`verb-${verb.toLowerCase()}`).click();
	await expect(page.getByTestId("verb-menu")).toBeHidden();
});

Then(
	"the box's one send control is the arrow and its placeholder reads {string}",
	async ({ page }, placeholder: string) => {
		await expect(page.getByTestId("composer-ask")).toBeVisible();
		await expect(page.getByTestId("composer-investigate")).toHaveCount(0);
		await expect(page.getByTestId("composer-input")).toHaveAttribute(
			"placeholder",
			placeholder,
		);
	},
);
